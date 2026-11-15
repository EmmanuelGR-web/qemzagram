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

Hay dos adaptadores de `BlobStorage`: `LocalBlobStorage` (carpeta `MEDIA_DIR`) y `S3BlobStorage` (cualquier servicio compatible con S3, con la firma SigV4 de `s3-signer.ts`). `storage.module.ts` elige uno según `STORAGE_DRIVER`; el resto del código no se entera.

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

## Bloqueos y personas cercanas (Fase 5)

```
bloquear  ─► BlocksController POST /blocks ─► BlocksService ─► BlocksRepository (user_blocks)
             las reglas se aplican en: ContactsService, UsersService (perfil), ChatsService (requireCanSend),
             CallsService (start/join) y DENTRO del SQL de estados y cercanos (noBlockBetween)
visible   ─► el navegador: posición ─► toNearbyCell (shared) ─► PUT /nearby/me { cell, consent: true }
             ─► NearbyService (límites de cambios) ─► NearbyRepository (nearby_presence: solo la celda)
buscar    ─► GET /nearby ─► candidatos por filas de la grilla (SQL) ─► distancia entre celdas ─► rangos
saludar   ─► POST /nearby/greetings ─► GreetingsService (¿está cerca AHORA?) ─► "nearby:greeting"
aceptar   ─► POST /nearby/greetings/:id/accept ─► transacción: saludo aceptado + agenda mutua ─► "nearby:connected"
reloj     ─► NearbyCleanupService (cada 5 min): borra las zonas vencidas
```

## Silenciar, denuncias y soporte (Fase 6)

```
mensaje    ─► ChatsService.publish ─► tiempo real a todos + PushService.notify a quienes NO silenciaron (sin texto)
silenciar  ─► PUT /chats/:id/mute { duration } ─► conversation_members.muted_until (solo para quien lo pide)
denunciar  ─► POST /reports ─► ReportsService: ¿la evidencia es visible para quien denuncia y la escribió el denunciado?
              ─► copia cifrada (texto + archivo) ─► reports + report_evidence en UNA transacción
soporte    ─► /support/* (SupportGuard: rol leído de la base) ─► SupportService ─► Reports/Appeals/SupportStats repositories
              confirmar ─► ¿3 denunciantes distintos? ─► baja: sesiones + tiempo real + cercanos + push + correo
evidencia  ─► GET /media/r/:id (firma + rol support) ─► MediaService.getEvidenceForSupport
apelar     ─► POST /auth/appeal (mismas credenciales que el login) ─► appeals ─► soporte acepta/rechaza ─► correo
roles      ─► npm run support:grant -- @tag ─► support-role.cli.ts (sin HTTP) ─► UsersRepository.setRole
reloj      ─► SupportCleanupService (cada 6 h): borra la evidencia de denuncias resueltas hace más de 180 días
```

## Endurecimiento (Fase 7A)

```
login       ─► POST /auth/login (PowGuard: anti-bots) ─► ¿contraseña OK? ─► ¿tiene 2FA?
                 no ─► sesión (cookies qz_at / qz_rt)
                 sí ─► cookie qz_mfa (ticket 5 min, SIN sesión) ─► POST /auth/mfa/verify
                        totp/backup ─► MfaService   ·   passkey ─► POST /auth/mfa/passkey/options ─► PasskeysService
2FA         ─► /auth/mfa/* (con sesión) ─► MfaService (TOTP + códigos) / PasskeysService (WebAuthn)
anti-bots   ─► GET /auth/pow?purpose=… ─► desafío firmado ─► el navegador lo resuelve (shared/pow.ts)
               ─► cabecera x-qz-pow ─► PowGuard ─► PowService (firma, propósito, vencimiento, un solo uso en KeyValueStore)
límites     ─► ThrottlerGuard ─► KvThrottlerStorage ─► KeyValueStore (memoria | Redis)
CSP         ─► web: src/proxy.ts genera el nonce por respuesta ─► Next lo pone en sus <script>
```

## Cifrado de extremo a extremo (Fase 7B)

```
claves      ─► navegador: generateIdentity() + código de recuperación ─► encryptKeyBackup (PBKDF2 + AES-GCM)
               ─► POST /e2ee/keys (pública + copia cifrada) ─► E2eeService ─► E2eeKeysRepository (e2ee_keys)
               dispositivo nuevo: GET /e2ee/keys/me ─► decryptKeyBackup(código) ─► IndexedDB (no exportable)
enviar      ─► GET /e2ee/conversations/:id/keys ─► ¿todos con clave? ─► sealMessage (shared/e2ee.ts)
               ─► POST /chats/:id/e2ee/messages | /e2ee/attachments (multipart: meta + archivo cifrado)
               ─► ChatsService.assertEnvelopeKeys (exactamente las claves actuales) ─► messages.e2ee + franking
recibir     ─► MessageDto.e2ee ─► POST /e2ee/keys/lookup (clave de quien envía) ─► openMessage + verificar franqueo
denunciar   ─► el dispositivo revela { content, fk } ─► ReportsService verifica HMAC ─► evidencia "verificada"
llamar      ─► sealCallKey ─► POST /chats/:id/calls { e2ee } ─► calls.e2ee ─► openCallKey ─► LiveKit (encryption)
```

La biblioteca criptográfica vive en `packages/shared/src/e2ee.ts`: la usan la web **y** los tests de la API (Node tiene la misma WebCrypto), así que los tests ejercitan el protocolo real. La limpieza de archivos está en `apps/web/src/lib/media-sanitize.ts`.

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
| `users` | Cuenta: correo único, tag único, hash de contraseña, perfil, estado (`active`/`paused`/`banned`/`deleted`), rol (`user`/`support`), bloqueos, 2FA (`mfa_enabled`, secreto TOTP **cifrado**, último paso usado) y desafío WebAuthn vigente (**cifrado**, 5 min) |
| `email_tokens` | Enlaces de verificación y de recuperación (solo hash, un uso, vencen) |
| `sessions` | Refresh tokens rotativos (solo hash), con detección de reutilización |
| `contacts` | Agenda: quién agregó a quién |
| `conversations` / `conversation_members` | Chats 1 a 1 y grupos (máx. 10), con rol admin/miembro y hasta cuándo cada miembro silenció el chat (`muted_until`) |
| `messages` | Mensajes con el cuerpo **cifrado** (texto o epígrafe) y, si corresponde, el código de un sticker del pack general. Si es de extremo a extremo: `e2ee` (sobre que el servidor no puede abrir) y `franking` (compromiso HMAC para denuncias); el cuerpo va vacío |
| `attachments` | Adjuntos de mensajes (imagen, documento, voz, video, sticker enviado): tipo MIME del servidor, tamaño, dimensiones/duración, nombre original **cifrado** y clave del archivo cifrado. `e2ee = true`: bytes cifrados por el dispositivo (tipo real, nombre y clave dentro del mensaje) |
| `e2ee_keys` | Claves de cifrado de extremo a extremo: **clave pública** y copia de la privada **cifrada con el código de recuperación**. Una activa por cuenta (índice único parcial); las reemplazadas quedan para verificar mensajes viejos |
| `stickers` | "Mis stickers" de cada persona (archivo cifrado, visible solo para su dueño) |
| `statuses` | Estados de 24 h: tipo (texto/foto/video), texto **cifrado**, fondo, archivo cifrado y `expires_at` |
| `status_audience_members` | Listas de privacidad de los estados ("excepto" y "solo con"); la opción elegida vive en `users.status_audience` |
| `calls` / `call_participants` | Llamadas: tipo, estado, quién llamó, cuándo se atendió/terminó y por qué; estado de cada participante. Una sola llamada abierta por chat (índice único parcial). `e2ee`: clave de la llamada envuelta para cada miembro |
| `user_blocks` | Bloqueos (quién bloqueó a quién); se aplican en las dos direcciones |
| `nearby_presence` | "Personas cercanas": **solo la celda** de ~1 km, hasta cuándo es visible y contadores anti-rastreo. Celda en null = invisible |
| `nearby_greetings` | Saludos entre personas cercanas (pendiente / aceptado / rechazado), uno por pareja y dirección |
| `reports` | Denuncias: quién, a quién, motivo, descripción **cifrada**, estado (pendiente/confirmada/descartada) y quién la resolvió. Una pendiente por pareja (índice único parcial) |
| `report_evidence` | **Copia cifrada** de los mensajes o estados que eligió quien denunció (texto, sticker y archivo con clave propia). `verified`: mensaje E2EE comprobado con el franqueo |
| `appeals` | Apelaciones de cuentas dadas de baja: mensaje **cifrado**, estado y quién la resolvió. Una pendiente por cuenta |
| `mfa_backup_codes` | Códigos de respaldo del 2FA: solo su **HMAC** con clave del servidor, de un solo uso |
| `passkeys` | Llaves de acceso: id de la credencial, **clave pública**, contador anti-clonado, transportes y nombre |
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
