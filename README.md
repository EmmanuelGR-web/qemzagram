# Qemzagram · by Neoematech

> **Conectá. Compartí. Disfrutá.**
> Red social de mensajería **sin número de teléfono**: cada persona se identifica con un **tag** (`@tuusuario`), un correo verificado y una contraseña segura.

Este repositorio contiene la **Fase 1** del proyecto: la base segura (cuentas, perfil, agenda, chats y grupos en tiempo real). Las funciones restantes están planificadas en [`docs/FASES.md`](docs/FASES.md).

---

## 1. Qué incluye la Fase 1

| Área | Estado |
|---|---|
| Registro con **correo verificable**, tag único y contraseña segura (1 cuenta por correo, tags y correos no repetibles) | ✅ |
| Inicio de sesión con tag o correo, cierre de sesión, sesiones con renovación segura | ✅ |
| **Recuperar contraseña por correo** (soporte técnico: ver `docs/SEGURIDAD.md`) | ✅ |
| Perfil estilo red social: **foto de perfil + portada**, nombre, biografía | ✅ |
| Perfil **público o privado** | ✅ |
| **Agenda por tag**: agregar contactos con `@tag` | ✅ |
| Chats 1 a 1 y **grupos de hasta 10 miembros** (solo con gente de tu agenda), mensajes en **tiempo real** | ✅ |
| Mensajes **cifrados en la base de datos** (AES-256-GCM) | ✅ |
| Ajustes: tema claro/oscuro/automático, **tamaño de texto**, **fondo de chat**, privacidad | ✅ |
| **Suspender** la cuenta temporalmente y **dar de baja** definitivamente | ✅ |
| Menú móvil: **barra superior fija + panel desplegable** | ✅ |
| Diseño rojo y blanco, responsive (celular, tablet, PC), instalable como app (PWA) | ✅ |
| Fotos/videos/audios/archivos en el chat, stickers propios, estados, llamadas, personas cercanas, panel de soporte | 🔜 Fases 2 a 6 |
| Cifrado de extremo a extremo (E2EE) | 🔜 Fase 7 |

> ⚠️ **Sobre la seguridad y el cumplimiento legal:** esta base aplica prácticas profesionales (OWASP, Argon2id, JWT de vida corta, cifrado, validación estricta, 20 pruebas automáticas, 0 vulnerabilidades conocidas en dependencias). Pero **ningún software puede garantizar "cero errores"**, y cumplir ISO 27001 o la Ley 25.326 requiere procesos, auditoría externa y asesoría legal. Leé [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) con honestidad antes de lanzar al público.

---

## 2. Qué necesitás instalar

1. **Node.js 20.12 o superior** (recomendado 22 LTS) → https://nodejs.org
   Comprobá en una terminal: `node -v`
2. **Docker Desktop** (recomendado, para PostgreSQL y la bandeja de correos de prueba) → https://www.docker.com/products/docker-desktop
   *Si no querés usar Docker, hay un modo alternativo más abajo.*
3. **VS Code** (ya lo tenés).

---

## 3. Puesta en marcha paso a paso

Abrí la carpeta `qemzagram` en VS Code y una terminal integrada (`Ctrl + ñ` o menú *Terminal → Nueva terminal*). Todos los comandos se ejecutan en la **raíz** del proyecto.

### Paso 1 — Instalar dependencias
```bash
npm install
```
Esto instala todo (API, web y el paquete compartido) y compila el paquete `shared` automáticamente.

### Paso 2 — Crear tu configuración con secretos aleatorios
```bash
npm run setup
```
Crea `apps/api/.env` con claves únicas para tu equipo. **Guardá una copia segura** de `PASSWORD_PEPPER` y `MESSAGE_ENC_KEY`: si se pierden, no se pueden recuperar contraseñas ni mensajes cifrados.

### Paso 3 — Levantar la base de datos y la bandeja de correos
```bash
npm run db:up
```
Inicia PostgreSQL y **Mailpit** (recibe los correos de la app; los ves en http://localhost:8025).

> **¿Sin Docker?** Usá en su lugar `npm run setup:sin-docker`. La app usa una base embebida (PGlite) y los enlaces de los correos aparecen en la consola de la API. Solo para desarrollo.

### Paso 4 — Iniciar la API (terminal 1)
```bash
npm run dev:api
```
Esperá el mensaje `API lista en http://localhost:4000`. Las tablas se crean solas la primera vez.

### Paso 5 — Iniciar la web (terminal 2, abrí otra terminal con el botón `+`)
```bash
npm run dev:web
```
Abrí **http://localhost:3000** en el navegador.

### Paso 6 — Probarlo
1. Tocá **Crear cuenta**, completá correo, tag y contraseña.
2. Abrí **http://localhost:8025** (Mailpit), abrí el correo y tocá **Verificar mi correo**.
3. Iniciá sesión.
4. Creá una segunda cuenta en una ventana de incógnito. Agregá su `@tag` en **Contactos**, abrí un chat y escribí: ¡llega en tiempo real!
5. Probá **Ajustes** (tema, texto, fondo) y **Perfil** (foto y portada).

> Desde el celular (misma red Wi-Fi): abrí `http://IP-DE-TU-PC:3000`. Para producción necesitás HTTPS (ver sección 8).

---

## 4. Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Inicia API / web en modo desarrollo |
| `npm test` | Ejecuta las **20 pruebas automáticas** (seguridad, perfil, agenda, chats, tiempo real) |
| `npm run typecheck` | Revisa los tipos de TypeScript en API y web |
| `npm run build` | Compila todo para producción |
| `npm run audit` | Busca vulnerabilidades conocidas en dependencias |
| `npm run db:up` / `npm run db:down` | Inicia / detiene PostgreSQL y Mailpit |
| `npm run db:generate` | Genera una migración SQL tras cambiar `apps/api/src/database/schema.ts` |

---

## 5. Estructura del proyecto

```
qemzagram/
├─ apps/
│  ├─ api/                    ← Backend (NestJS + PostgreSQL + Socket.IO)
│  │  ├─ drizzle/             ← Migraciones SQL versionadas
│  │  ├─ src/
│  │  │  ├─ auth/             ← registro, login, tokens, recuperación
│  │  │  ├─ users/            ← perfil, fotos, privacidad, pausar/eliminar cuenta
│  │  │  ├─ contacts/         ← agenda por tag
│  │  │  ├─ chats/            ← conversaciones, grupos, mensajes
│  │  │  ├─ realtime/         ← entrega en tiempo real (WebSocket)
│  │  │  ├─ mail/             ← envío de correos (puerto + implementación SMTP)
│  │  │  ├─ storage/          ← procesamiento seguro de imágenes
│  │  │  ├─ database/         ← esquema y repositorios
│  │  │  ├─ common/           ← cifrado, auditoría, guards, validación
│  │  │  └─ config/           ← validación de variables de entorno
│  │  └─ test/                ← pruebas automáticas
│  └─ web/                    ← Frontend (Next.js + React, PWA)
│     └─ src/{app,components,lib}
├─ packages/
│  └─ shared/                 ← Tipos y validaciones compartidas (una sola fuente de verdad)
├─ docs/                      ← SEGURIDAD.md · ARQUITECTURA.md · FASES.md
├─ scripts/setup-env.mjs      ← generador de configuración
└─ docker-compose.yml         ← PostgreSQL + Mailpit para desarrollo
```

Más detalle y los principios SOLID aplicados: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## 6. Seguridad en resumen

- Contraseñas con **Argon2id** + pepper secreto; política de 12+ caracteres con mayúscula, minúscula, número y símbolo; rechazo de contraseñas comunes y de las que contienen tu tag o correo.
- Correo **verificado obligatoriamente**; enlaces de un solo uso que vencen (24 h / 1 h) y se guardan solo como hash.
- Sin enumeración de usuarios; bloqueo tras 5 intentos fallidos; límite de peticiones por ruta.
- Sesión con **cookies HttpOnly + SameSite=Strict**, access token de 15 min y refresh token rotativo con **detección de robo**.
- Protección **CSRF** (verificación de origen), validación estricta de toda entrada (Zod), cabeceras de seguridad (Helmet, CSP, HSTS).
- Mensajes **cifrados en la base** (AES-256-GCM). Fotos re-procesadas (se eliminan metadatos y cualquier contenido oculto).
- Registro de auditoría de eventos sensibles; sin contraseñas ni mensajes en los logs.

Detalle completo, límites y pendientes legales: [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md).

---

## 7. Variables de entorno

Están documentadas una por una en [`apps/api/.env.example`](apps/api/.env.example). El servidor **no arranca** si falta una o es inválida (con un mensaje claro de qué corregir).

---

## 8. Publicación (resumen)

Antes de publicar para usuarios reales (guía completa pendiente en la Fase de despliegue):

- Servir **web y API bajo el mismo dominio principal con HTTPS** (la web reenvía `/api/*` a la API; las cookies son `Secure` en producción).
- Definir `WEB_ORIGIN` con la URL pública exacta de la web, y `API_URL` / `NEXT_PUBLIC_WS_URL` al **compilar** la web.
- Usar PostgreSQL gestionado con **backups**, un servicio SMTP real (con SPF/DKIM/DMARC) y almacenamiento de archivos externo (S3 o similar).
- Guardar los secretos en un gestor de secretos, nunca en el repositorio.

---

## 9. Problemas frecuentes

| Síntoma | Solución |
|---|---|
| `Configuración inválida. Revisá tu archivo .env` | Ejecutá `npm run setup` o completá la variable que indica el mensaje. |
| `ECONNREFUSED 127.0.0.1:5432` | La base no está iniciada: `npm run db:up` (y Docker Desktop abierto). |
| No llega el correo de verificación | Mirá http://localhost:8025 (Mailpit). Con `setup:sin-docker`, el enlace está en la consola de la API. |
| Puerto 3000 o 4000 ocupado | Cerrá el otro programa o cambiá `PORT` en `.env`. |
| En PowerShell: "la ejecución de scripts está deshabilitada" | Usá la terminal *Command Prompt* o ejecutá `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| Los chats no se actualizan solos | Verificá que la API esté en `http://localhost:4000` (o definí `NEXT_PUBLIC_WS_URL`). |

---

© Neoematech · Qemzagram. Proyecto en desarrollo.
