# CLAUDE.md — Guía para Claude Code en Qemzagram

Leé este archivo completo antes de tocar código. Es la fuente de verdad sobre cómo trabajar en este repositorio.

## 1. Qué es este proyecto

**Qemzagram** (by Neoematech) es una red social de mensajería **sin número de teléfono**: cada persona se identifica con un **tag** (`@usuario`), un **correo verificado** (1 cuenta por correo) y una contraseña segura. Es una alternativa a WhatsApp/Telegram.

- Es un proyecto **nuevo e independiente**. No tiene relación con "Modo Motivados" ni con ningún otro repo de Emmanuel. No copies código, dependencias ni convenciones de otros proyectos.
- Diseño: **rojo y blanco**, estilo premium, responsive, instalable (PWA). Menú móvil = barra superior fija + panel desplegable.
- Eslogan: *Conectá. Compartí. Disfrutá.*

## 2. Cómo comunicarte con el usuario

- Emmanuel es estudiante de la Tecnicatura Universitaria en Programación (UTN FRT, Tucumán).
- **Respondé siempre en español (rioplatense), con explicaciones paso a paso y detalladas.** Explicá el porqué de cada decisión y cada comando.
- Antes de cambios grandes, decí qué vas a hacer. Al terminar, resumí qué cambió y cómo probarlo.
- Sé honesto: si algo no se pudo verificar, decilo (por ejemplo, si no viste la interfaz en un navegador).

## 3. Estado actual y hoja de ruta

- ✅ **Fase 1 (hecha):** cuentas con correo verificado, login, recuperación de contraseña, perfil (foto + portada, público/privado), agenda por tag, chats 1 a 1 y grupos (máx. 10) en tiempo real, mensajes cifrados en la base, ajustes, pausar/dar de baja la cuenta.
- 🔜 **Fase 2:** imágenes (cámara/galería), videos, notas de voz, archivos, stickers generales y propios (almacenamiento externo con URLs firmadas, antivirus).
- Fases 3–7: estados 24 h, llamadas/videollamadas (WebRTC + SFU), personas cercanas, panel de soporte/denuncias/bajas, E2EE y endurecimiento.
- Detalle completo en [`docs/FASES.md`](docs/FASES.md). **Trabajá una fase a la vez** y no empieces la siguiente sin confirmación del usuario.

## 4. Stack y estructura

Monorepo con **npm workspaces**.

| Ruta | Qué es |
|---|---|
| `apps/api` | Backend: **NestJS 11**, **Drizzle ORM** + PostgreSQL, Socket.IO |
| `apps/web` | Frontend: **Next.js 16** (App Router) + React 19, PWA |
| `packages/shared` | Tipos y esquemas **Zod 4** compartidos por API y web (una sola fuente de verdad) |
| `docs/` | `SEGURIDAD.md`, `ARQUITECTURA.md`, `FASES.md` |
| `scripts/setup-env.mjs` | Genera `apps/api/.env` con secretos aleatorios |

Estructura del backend (`apps/api/src`): `auth/`, `users/`, `contacts/`, `chats/`, `realtime/`, `mail/`, `storage/`, `database/` (esquema + repositorios), `common/` (cifrado, auditoría, guards, pipes), `config/` (validación de `.env`). Tests en `apps/api/test/`.

Web (`apps/web/src`): `app/` (rutas: `(auth)` y `(app)`), `components/`, `lib/` (api, contextos de auth/chats/preferencias/tiempo real).

**No crees archivos ni carpetas sueltas.** Todo va en su módulo. Leé [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) antes de agregar un módulo.

## 5. Comandos (desde la raíz)

```bash
npm install                 # instala todo y compila packages/shared
npm run setup               # crea apps/api/.env con secretos (con Docker)
npm run setup:sin-docker    # idem pero usa PGlite (Postgres embebido, solo desarrollo)
npm run db:up / db:down     # PostgreSQL + Mailpit (http://localhost:8025) con Docker
npm run dev:api             # API en http://localhost:4000
npm run dev:web             # Web en http://localhost:3000
npm test                    # tests (API) — ver nota de abajo
npm run typecheck           # tipos de API y web
npm run build               # compila todo
npm run audit               # npm audit (debe dar 0 vulnerabilidades)
npm run db:generate         # genera migración SQL tras cambiar schema.ts
```

**Antes de dar una tarea por terminada, corré:** `npm run typecheck`, `npm test` y `npm run audit`. Nada se entrega con tests rotos ni con errores de tipos.

## 6. Reglas de arquitectura (SOLID, tipado fuerte)

- TypeScript **`strict`** en todo. **Prohibido `any`** (si es imprescindible, usá `unknown` + validación) y los `// @ts-ignore`.
- Capas del backend: **Controller → Service → Repository**.
  - Controller: recibe la petición y valida con Zod (`ZodPipe`). Sin lógica de negocio.
  - Service: reglas de negocio y autorización.
  - Repository: **única capa que escribe SQL** (Drizzle). Los servicios no consultan la base directamente.
- Servicios externos detrás de **puertos** (`MailPort`, `RealtimePublisher`). Para uno nuevo (p. ej. almacenamiento S3, antivirus) creá un puerto + implementación, y una versión falsa para tests.
- Los tipos/esquemas Zod que usan API **y** web viven en `packages/shared`. Después de cambiarlos: `npm run build -w packages/shared` (o `npm install`/`npm run build`).
- Un módulo nuevo = su carpeta con `*.module.ts`, `*.controller.ts`, `*.service.ts`, y el repositorio en `database/repositories/` registrado en `database.module.ts`.
- Cambios en la base: editá `apps/api/src/database/schema.ts` → `npm run db:generate` → revisá el SQL generado en `apps/api/drizzle/`. Las migraciones corren al arrancar si `RUN_MIGRATIONS=true`. **Nunca edites a mano una migración ya aplicada.**

## 7. Reglas de seguridad (NO negociables)

Es una red social: un error de seguridad es el peor error posible. Respetá siempre:

1. **Toda ruta exige sesión** salvo las marcadas `@Public()`. Los guards globales (orden en `AppModule`): Throttler → `OriginGuard` (CSRF) → `JwtAuthGuard`. No los saltees ni los reordenes.
2. **Validá toda entrada con Zod** (esquemas estrictos, listas cerradas de campos). Nunca aceptes del cliente `role`, `status`, ids de otro usuario, etc.
3. **Autorización en cada recurso:** verificá que el usuario sea miembro/dueño. Si no, respondé "no encontrado" (no reveles que existe).
4. **Sin SQL concatenado.** Solo consultas parametrizadas de Drizzle.
5. **Tokens y sesiones:** cookies `HttpOnly` + `SameSite=Strict` (`qz_at`, `qz_rt`). **Nunca uses `localStorage`/`sessionStorage` para tokens.** Los tokens aleatorios (verificación, reset, refresh) se guardan **solo como hash SHA-256**.
6. **Contraseñas:** Argon2id + pepper (`PASSWORD_PEPPER`). Nunca registres ni devuelvas contraseñas, hashes, tokens ni contenido de mensajes en logs o respuestas.
7. **Anti-enumeración:** las respuestas de registro/login/recuperación no deben revelar si un correo existe (conservá el mismo código y el equiparado de tiempos).
8. **Mensajes:** cifrados con AES-256-GCM (clave `MESSAGE_ENC_KEY`, AAD = id de conversación). Esto **no es E2EE** (lo hará la Fase 7); no lo describas como E2EE.
9. **Archivos subidos:** validá el **contenido real** (no la extensión ni el `Content-Type` del cliente), limitá tamaño, re-codificá (quitar EXIF/metadatos), nombres aleatorios (UUID), servilos con `X-Content-Type-Options: nosniff`. Para la Fase 2: almacenamiento externo, URLs firmadas con vencimiento y antivirus.
10. **Soporte:** el rol `support` **jamás** puede leer conversaciones. No crees endpoints que lo permitan; solo estadísticas agregadas, denuncias y bajas.
11. **Ubicación (Fase 5):** solo opt-in, coordenadas aproximadas, nunca exactas.
12. **Auditoría:** eventos sensibles van a `audit_log` mediante `AuditService`. Los correos se enmascaran en logs.
13. **Dependencias:** agregá solo lo necesario, con versiones fijadas razonablemente; corré `npm run audit` después de instalar algo.
14. **Secretos:** nunca los pongas en el código ni en el repo. `.env*` está en `.gitignore`; no lo subas.

Detalle y límites honestos (qué NO está implementado): [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md). Mantené ese documento actualizado cuando cambie algo de seguridad.

## 8. Reglas de negocio clave

- Tag: `^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$`, único, con lista de tags reservados. Correo único.
- Contraseña: 12+ caracteres, mayúscula, minúscula, número y símbolo; sin fragmentos comunes; sin el tag/correo adentro; sin 4 caracteres repetidos seguidos.
- Chats y grupos **solo con personas de tu agenda**. Grupo: máx. **10** miembros incluyendo al creador. Chat directo sin duplicados (`directKey`).
- Perfil privado: oculta bio y portada a quienes no son contactos.
- Estados de cuenta: `active` / `paused` (se reactiva al iniciar sesión) / `banned` / `deleted` (anonimización irreversible: correo y tag se reemplazan, sesiones revocadas).
- Bloqueo tras 5 logins fallidos durante 15 minutos.

## 9. Tests

- Jest + ts-jest + supertest + socket.io-client, con **PGlite en memoria** (`pglite://memory`): no necesitan Docker.
- Se ejecutan con `node --experimental-vm-modules` (ya configurado en `npm test`). **No cambies ese flag**: PGlite usa `import()` dinámico y falla sin él.
- Los helpers están en `apps/api/test/support/test-app.ts` (`createTestApp`, `signUp`, `FakeMail`, `setCookies`).
- **Toda funcionalidad nueva lleva tests**, incluidos los casos negativos de seguridad (sin sesión, usuario ajeno, entradas inválidas, límites).

## 10. Trampas conocidas

- `npm run dev:web` hace proxy de `/api/*` hacia `API_URL` (por defecto `http://localhost:4000`); ese valor se fija **al compilar** la web.
- El WebSocket se conecta directo a `NEXT_PUBLIC_WS_URL` con un **ticket de 60 s** (`POST /auth/ws-ticket`); la cookie nunca viaja por el socket. Los mensajes se envían por REST; el socket solo entrega.
- Modo `setup:sin-docker`: la base vive en `apps/api/.data/dev` (se crea sola) y los enlaces de los correos salen en la consola de la API.
- La CSP de la web usa `'unsafe-inline'` (pendiente: nonce). Está documentado; no lo "arregles" sin probar que Next sigue funcionando.
- La interfaz **no fue revisada visualmente por un humano todavía**: si ves problemas de diseño en el navegador, corregilos respetando el sistema de diseño de `apps/web/src/app/globals.css` (variables de color rojo/blanco, temas claro/oscuro, tamaños de texto, fondos de chat).

## 11. Cómo trabajar una tarea nueva

1. Leé `docs/FASES.md` y el módulo afectado.
2. Explicale al usuario el plan (paso a paso).
3. Implementá por capas: esquema/migración → repositorio → servicio → controlador → esquemas en `shared` → pantalla en la web.
4. Escribí los tests (incluidos los de seguridad).
5. Corré `npm run typecheck`, `npm test`, `npm run audit` y, si tocaste la web, `npm run build`.
6. Actualizá `README.md`, `docs/FASES.md` y `docs/SEGURIDAD.md` si cambió algo visible.
7. Resumí al usuario qué hiciste y cómo probarlo, en español.

## 12. Git

- Repositorio remoto (privado): `https://github.com/EmmanuelGR-web/qemzagram.git` (cuenta `EmmanuelGR-web`). Es el `origin`. Si la carpeta aún no es un repo git, el primer push es: `git init`, `git branch -M main`, `git add .`, `git commit -m "Fase 1: base segura de Qemzagram"`, `git remote add origin https://github.com/EmmanuelGR-web/qemzagram.git`, `git push -u origin main`. Verificá con `git status` que no entre ningún `.env` ni `node_modules`.
- Este repo es independiente: **nunca** agregues como remoto ni mezcles historia con otros repos de Emmanuel (Modo Motivados, C-DEPORTIVO, etc.).
- Rama principal: `main`. Commits chicos y descriptivos, en español (por ejemplo `Fase 2: subida de imágenes en el chat`).
- Nunca subas `.env`, `node_modules`, `dist`, `.next`, `.data` ni `uploads` (ya están en `.gitignore`).
- No hagas `push --force` ni reescribas historia sin que el usuario lo pida.
