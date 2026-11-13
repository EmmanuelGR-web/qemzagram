# Arquitectura de Qemzagram

## Visión general

```
 Navegador / PWA
   │  (mismo origen)            WebSocket (ticket de 60 s)
   ▼                                   │
 Web · Next.js :3000 ──/api/*──► API · NestJS :4000 ◄────────┘
                                       │
                        ┌──────────────┼───────────────┐
                        ▼              ▼               ▼
                   PostgreSQL        Correo SMTP   Archivos (fotos públicas de perfil
                                                  + adjuntos CIFRADOS)
                                       │
                        ClamAV (antivirus) · ffmpeg (voz y video)
```

- La **web** nunca habla con la API desde otro origen: Next reenvía `/api/*`. Así las cookies de sesión son *first-party* (`HttpOnly`, `SameSite=Strict`) y no hace falta abrir CORS.
- El **tiempo real** usa un *ticket* de 60 segundos que se pide por HTTP; la cookie de sesión nunca viaja por el WebSocket.

## Capas del backend (por módulo)

```
Controller  →  Service  →  Repository  →  Base de datos
(HTTP, validación)  (reglas de negocio)  (consultas SQL)
```

| Capa | Responsabilidad | Ejemplo |
|---|---|---|
| Controller | Recibir la petición, validar con Zod, devolver la respuesta | `chats.controller.ts` |
| Service | Reglas de negocio y autorización | `chats.service.ts` (¿es miembro? ¿está en la agenda? ¿grupo lleno?) |
| Repository | Única capa que habla SQL | `conversations.repository.ts` |
| Puertos | Abstracciones de servicios externos | `MailPort`, `RealtimePublisher`, `BlobStorage`, `AntivirusPort`, `MediaTranscoder` |

## Multimedia (Fase 2)

```
subida ─► ChatsController (multer, límites) ─► ChatsService (¿miembro?)
        ─► MediaProcessor: tamaño → tipo real → AntivirusPort → sharp / MediaTranscoder(ffmpeg)
        ─► CryptoService.encryptBlob ─► BlobStorage.put ─► AttachmentsRepository (mensaje + adjunto en 1 transacción)
        ─► RealtimePublisher (chat:message)

descarga ─► MediaController GET /media/a/:id?exp&sig ─► MediaService: firma + vencimiento + ¿miembro actual?
          ─► BlobStorage.get ─► decryptBlob ─► respuesta con rangos, nosniff y CSP sandbox
```

Para agregar un proveedor de almacenamiento (S3/R2) se crea otra clase que extienda `BlobStorage` y se cambia el `provide` en `storage.module.ts`; nada más cambia.

## Estados (Fase 3)

```
publicar ─► StatusesController (Zod / multer) ─► StatusesService (cupo de 30)
         ─► [foto/video] MediaProcessor ─► encryptBlob ─► BlobStorage ─► StatusesRepository
         ─► RealtimePublisher "status:changed" (solo a la audiencia; sin contenido)

ver      ─► StatusesRepository.listFeed / findVisible: la regla "contacto mutuo + privacidad + no vencido"
            va DENTRO de la consulta SQL
archivo  ─► StatusMediaController GET /media/e/:id?exp&sig ─► firma + findVisible ─► readBlob
limpieza ─► StatusesCleanupService (cada 5 min): borra vencidos y sus archivos
```

## Llamadas (Fase 4)

```
iniciar  ─► CallsController POST /chats/:id/calls ─► CallsService (¿miembro? ¿ya hay una?)
         ─► CallsRepository (llamada + participantes) ─► CallMediaPort.createJoinToken (2 min, 1 sala)
         ─► RealtimePublisher "call:incoming" + PushService (Web Push) a quienes están invitados
atender  ─► POST /calls/:id/join ─► token ─► el navegador se conecta DIRECTO a LiveKit (audio/video)
cortar   ─► POST /calls/:id/leave | decline ─► fin condicional ─► CallMediaPort.closeRoom
         ─► ChatsService.postCallLog (mensaje "Llamada perdida"/"Videollamada · 3:12")
LiveKit  ─► POST /calls/livekit-webhook (firmado) ─► CallsService.handleMediaEvent
reloj    ─► CallsTimeoutService (cada 5 s): "perdida" a los 45 s, corte a las 4 h
```

## Cómo se aplica SOLID

- **S — Responsabilidad única:** cada clase hace una cosa (`CryptoService` cifra, `AuditService` audita, `StorageService` procesa imágenes, `TokensService` firma tokens).
- **O — Abierto/cerrado:** para agregar un tipo de mensaje o un proveedor de correo se agregan clases nuevas sin tocar las existentes.
- **L — Sustitución de Liskov:** `SmtpMailService` y la implementación falsa de los tests son intercambiables bajo `MailPort`.
- **I — Segregación de interfaces:** puertos pequeños y específicos (`MailPort` solo manda correos; `RealtimePublisher` solo publica eventos).
- **D — Inversión de dependencias:** los servicios dependen de **abstracciones** (`MailPort`, `RealtimePublisher`, repositorios inyectados), no de nodemailer ni de Socket.IO. Esto permite probar todo sin servicios reales.

## Código fuertemente tipado

- TypeScript en modo `strict` en todo el proyecto.
- `packages/shared`: tipos (DTO) y esquemas Zod **compartidos** entre API y web: el formulario del navegador y el servidor validan con las mismas reglas.
- Drizzle ORM: el esquema de la base genera los tipos de las filas; una consulta mal escrita no compila.
- Variables de entorno validadas y tipadas (`AppEnv`).

## Modelo de datos

| Tabla | Para qué |
|---|---|
| `users` | Cuenta: correo único, tag único, hash de contraseña, perfil, estado (`active`/`paused`/`banned`/`deleted`), rol (`user`/`support`), bloqueos |
| `email_tokens` | Enlaces de verificación y de recuperación (solo hash, un uso, vencen) |
| `sessions` | Refresh tokens rotativos (solo hash), con detección de reutilización |
| `contacts` | Agenda: quién agregó a quién |
| `conversations` / `conversation_members` | Chats 1 a 1 y grupos (máx. 10), con rol admin/miembro |
| `messages` | Mensajes con el cuerpo **cifrado** (texto o epígrafe) y, si corresponde, el código de un sticker del pack general |
| `attachments` | Adjuntos de mensajes (imagen, documento, voz, video, sticker enviado): tipo MIME del servidor, tamaño, dimensiones/duración, nombre original **cifrado** y clave del archivo cifrado |
| `stickers` | "Mis stickers" de cada persona (archivo cifrado, visible solo para su dueño) |
| `statuses` | Estados de 24 h: tipo (texto/foto/video), texto **cifrado**, fondo, archivo cifrado y `expires_at` |
| `status_audience_members` | Listas de privacidad de los estados ("excepto" y "solo con"); la opción elegida vive en `users.status_audience` |
| `calls` / `call_participants` | Llamadas: tipo, estado, quién llamó, cuándo se atendió/terminó y por qué; estado de cada participante. Una sola llamada abierta por chat (índice único parcial) |
| `push_subscriptions` | Dispositivos con notificaciones: dirección y claves **cifradas**, hash de la dirección para no duplicar |
| `status_views` | Quién vio cada estado (solo lo consulta el dueño; se borra con el estado) |
| `audit_log` | Eventos de seguridad (incluye archivos bloqueados por el antivirus) |

## Decisiones técnicas

| Decisión | Motivo |
|---|---|
| **Drizzle ORM** en vez de Prisma | Tipado fuerte igual de estricto, SQL transparente, y no depende de motores binarios descargados en tiempo de instalación (más simple y reproducible). |
| **PGlite** para tests y modo sin Docker | PostgreSQL real compilado a WebAssembly: las pruebas ejercitan SQL verdadero sin infraestructura. |
| **Cookies HttpOnly** en lugar de `localStorage` | Un ataque XSS no puede leer los tokens. |
| **Argon2id + pepper** | Estándar actual recomendado por OWASP para contraseñas. |
| **Envío de mensajes por REST, entrega por WebSocket** | La ruta REST ya tiene validación, límites y autorización; el socket solo entrega. Menos superficie de ataque. |
| **Chats solo con gente de la agenda** | Reduce spam y hostigamiento: nadie puede escribirte sin que alguien lo haya agregado primero con tu tag. |
| **Pausar vs. dar de baja** | Pausa = reversible (se reactiva al iniciar sesión). Baja = anonimización irreversible de datos personales y liberación del tag. |
