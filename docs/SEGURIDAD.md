# Seguridad y cumplimiento — Qemzagram

Este documento dice **qué está implementado, qué no, y qué falta** para operar de forma responsable. Está escrito a propósito sin exageraciones: en seguridad, saber lo que *no* se cubre es tan importante como lo que sí.

## 1. Lo que hay que tener claro

1. **No existe el software sin errores.** Lo que sí se puede hacer es reducir el riesgo con buenas prácticas, pruebas, revisión de dependencias, auditorías externas y monitoreo continuo. Esta base ya cuenta con 45 pruebas automáticas de seguridad y 0 vulnerabilidades conocidas en las dependencias de producción (`npm run audit`), pero eso se debe **repetir en cada cambio**.
2. **Cumplir ISO 27001 no es una propiedad del código**: es la certificación de un *sistema de gestión de seguridad de la información* (políticas, roles, análisis de riesgos, capacitación, proveedores, respuesta a incidentes) que audita un ente certificador. El código puede ayudar con los controles técnicos, pero no certifica nada por sí solo.
3. **Ninguna app puede garantizar que "no te multen"**. La responsabilidad legal depende de cómo la operés (políticas, consentimiento, atención de reclamos, notificación de incidentes). Consultá con un/a abogado/a especializado/a en datos personales.

## 2. Controles técnicos implementados

| Riesgo (OWASP Top 10) | Control en Qemzagram |
|---|---|
| **A01 Control de acceso** | Todas las rutas exigen sesión salvo las marcadas `@Public()`. Cada conversación verifica que seas miembro; si no, responde "no encontrada" (no revela que existe). Los perfiles privados muestran datos reducidos. Los campos del perfil se validan con lista cerrada (no se puede enviar `role`, `status`, etc.). |
| **A02 Fallas criptográficas** | Contraseñas con **Argon2id** (19 MiB, 2 iteraciones) + *pepper* secreto del servidor. Mensajes con **AES-256-GCM** y datos asociados (id de conversación). Tokens con 256 bits de aleatoriedad, guardados solo como SHA-256. JWT con algoritmo fijado (HS256), `aud`, `iss` y expiración. |
| **A03 Inyección** | Consultas parametrizadas con Drizzle ORM (sin SQL concatenado). Validación de *toda* entrada con Zod. Texto de usuarios renderizado por React (escapado) y plantillas de correo con escape HTML. |
| **A04 Diseño inseguro** | Tokens de un solo uso con vencimiento; rotación de *refresh tokens* con **detección de reutilización** (si un token robado reaparece, se cierran todas las sesiones); WebSocket con ticket de 60 s en lugar de la cookie de sesión. |
| **A05 Configuración** | Variables de entorno validadas al iniciar (si falta una, no arranca). Helmet + HSTS + CSP en la API; CSP, `X-Frame-Options`, `Permissions-Policy` y más en la web. Sin cabecera `X-Powered-By`. |
| **A06 Componentes vulnerables** | `npm run audit` (dependencias de producción): 0 vulnerabilidades. En herramientas de desarrollo quedan 7 avisos de severidad baja por `deepmerge` (usado internamente por `jest`): no existe versión corregida publicada y solo procesa la configuración local de los tests, nunca datos de usuarios. `@nestjs/cli` se actualizó a v12 y el `esbuild` interno de `drizzle-kit` se fuerza a 0.25 con `overrides`. Recomendado: activar Dependabot en GitHub. |
| **A07 Fallas de autenticación** | Política de contraseña fuerte; bloqueo de 15 min tras 5 intentos; límites por ruta (login 10/min, registro 5/min, recuperación 3/min); respuestas idénticas para usuario inexistente o contraseña errónea y mismo tiempo de respuesta; verificación de correo obligatoria; al restablecer contraseña se cierran todas las sesiones y se avisa por correo. |
| **A08 Integridad** | Migraciones versionadas; pruebas automáticas que corren el flujo completo. |
| **A09 Registro y monitoreo** | Tabla `audit_log` (registro, inicios de sesión fallidos/exitosos, bloqueos, reutilización de tokens, cambios de contraseña, pausa/baja). Los correos se enmascaran en los logs. No se registran contraseñas, tokens ni mensajes. |
| **A10 SSRF** | La API no realiza peticiones a URLs provistas por usuarios. ffmpeg solo puede leer archivos locales (`-protocol_whitelist file`). |

Otros controles: protección **CSRF** (verificación de `Origin` + cookies `SameSite=Strict`), **límite de tamaño** de cuerpos y de imágenes (5 MB, 40 megapíxeles), **validación del contenido real** de las imágenes (no de la extensión), re-codificación a WebP (elimina EXIF/GPS y código oculto), nombres de archivo aleatorios, `X-Content-Type-Options: nosniff`.

## 2.1 Archivos adjuntos y stickers (Fase 2)

Cada subida al chat pasa por el mismo recorrido, en este orden:

1. **Sesión, CSRF y membresía:** solo miembros de la conversación pueden subir o descargar; si no, "no encontrado".
2. **Tamaño máximo por tipo:** imágenes 10 MB, documentos 25 MB, notas de voz 10 MB, videos 50 MB, stickers 5 MB.
3. **Tipo REAL por contenido** ("números mágicos"), nunca por extensión ni por el `Content-Type` del navegador. Lista cerrada de formatos.
4. **Antivirus ClamAV** (`clamd`, protocolo INSTREAM). **Falla cerrado**: si no responde, la subida se rechaza. Cada detección queda en `audit_log`. **Obligatorio en producción** (sin `CLAMAV_HOST` la API no arranca).
5. **Re-codificación / limpieza:**
   - Imágenes → WebP sin EXIF/GPS (también neutraliza archivos "políglota").
   - Notas de voz → AAC/M4A y videos → H.264/MP4 con **ffmpeg**, quitando **todos** los metadatos (incluida la ubicación GPS que guardan los celulares). Sin ffmpeg, voz y video se rechazan: nunca se guardan sin limpiar. ffmpeg corre sin shell, con tiempo máximo y de a 2 procesos.
   - Stickers propios → WebP 512×512 con transparencia.
6. **Cifrado en reposo:** cada archivo se guarda cifrado con AES-256-GCM (clave derivada con HKDF de `MESSAGE_ENC_KEY`, datos asociados = id del adjunto), con nombre aleatorio (UUID) y **fuera** de la carpeta pública. El nombre original de los documentos también se guarda cifrado.
7. **Descarga con URL firmada** (HMAC, vence en ≈1 h) **y además** sesión + membresía actual. Cabeceras: `nosniff`, CSP `sandbox`, caché `private`. Los documentos se fuerzan a descarga (`Content-Disposition: attachment`).

**Documentos:** pdf, docx, xlsx, pptx, odt, ods, odp, zip, txt y csv. La extensión tiene que coincidir con el contenido y se rechazan los documentos de Office con macros. HTML, SVG, scripts y ejecutables se rechazan siempre porque **no están en la lista**.

**Stickers:** el pack general son SVG estáticos de la propia web. Los stickers propios solo los ve su dueño; al enviarlos se manda una **copia** como adjunto del chat.

**Límites honestos de la Fase 2:**
- Los **documentos no se modifican**: un PDF o un Word puede conservar metadatos internos (autor, empresa) y un PDF puede contener JavaScript (por eso se descarga y nunca se abre dentro de la app). El antivirus es la defensa principal.
- Un ZIP se valida solo por su firma: su contenido lo revisa el antivirus.
- El almacenamiento es **disco local** detrás del puerto `BlobStorage`. Para producción falta el adaptador S3/R2 (con URLs prefirmadas del proveedor) y backups.
- Los archivos se procesan **en memoria** (hasta 50 MB por subida, límite de peticiones por persona). Con mucho tráfico conviene una cola de trabajos.

## 2.2 Estados de 24 horas (Fase 3)

- **Quién los ve:** solo contactos **mutuos** (vos agregaste a la persona y ella te agregó), con cuenta activa, y según tu privacidad: "Mi agenda", "Mi agenda excepto…" o "Solo compartir con…". Las listas solo admiten personas de tu agenda. La regla se aplica **dentro de cada consulta SQL** (no se traen datos para filtrarlos después) y se evalúa con la configuración **actual**: si sacás a alguien, deja de ver tus estados al instante, aunque tenga una URL firmada.
- **Vencimiento:** toda consulta exige `expires_at > ahora`; una limpieza cada 5 minutos borra las filas vencidas y sus archivos cifrados. Un estado vencido nunca se muestra aunque la limpieza no haya corrido.
- **Contenido:** el texto/epígrafe se cifra con AES-256-GCM (datos asociados = `status:<id>`). Las fotos y videos pasan por el **mismo** recorrido de la §2.1 (tipo real → antivirus → re-codificación sin metadatos → cifrado en reposo). Los videos de estado duran como máximo 60 segundos. Hasta 30 estados vigentes por persona.
- **Archivos:** se sirven en `/media/e/:id` con URL firmada **y** permiso verificado en cada pedido; si no, "no encontrado".
- **Visto por:** solo el dueño consulta quién vio cada estado; para cualquier otra persona el estado "no existe". Las vistas se borran junto con el estado.
- **Tiempo real:** el aviso `status:changed` lleva solo el id del dueño (nunca contenido ni URLs) y se envía solo a su audiencia.
- **Baja de cuenta:** los estados y sus archivos se borran en el momento.

**Límites honestos de la Fase 3:**
- Quien puede ver un estado puede sacarle una captura de pantalla o grabarlo: ninguna app puede impedirlo del todo.
- El registro de "visto" lo informa el navegador de quien mira (solo para estados que ya puede ver): sirve como indicación, no como prueba.
- La limpieza corre dentro de la API. Si la API está apagada, los archivos vencidos quedan en disco (cifrados e inaccesibles) hasta que vuelva a arrancar.

## 2.3 Llamadas y notificaciones push (Fase 4)

- **El audio y el video nunca pasan por la API ni se guardan.** Viajan entre el navegador y el servidor de medios (LiveKit, SFU). Como todo pasa por el servidor, **nadie ve la IP de la otra persona** (en una llamada P2P directa sí se vería).
- **Quién entra:** solo miembros ACTUALES de la conversación pueden ver, iniciar, atender o cortar una llamada; para cualquier otra persona "no existe". Quien deja un grupo no puede entrar a su llamada.
- **Token de LiveKit:** lo emite la API, vale **2 minutos** para entrar, sirve para **una sola sala** (la llamada) y con permisos mínimos: publicar micrófono (y cámara solo en videollamadas), sin datos, sin metadatos, sin compartir pantalla, sin crear ni administrar salas. La identidad es el id de usuario que pone el servidor.
- **Webhook de LiveKit:** ruta pública pero **firmada**: se verifica el JWT con nuestro secreto y el hash SHA-256 del cuerpo; solo se aceptan salas que son llamadas nuestras e identidades que estaban adentro.
- **Credenciales:** en desarrollo LiveKit corre en modo `--dev` (claves públicas `devkey/secret`) y **solo escucha en tu PC**. En producción la API **no arranca** con esas claves ni sin `wss://`.
- **Notificaciones push:** protocolo Web Push estándar (VAPID). El contenido va **cifrado** de punta a punta entre la API y el navegador y es mínimo: quién llama y el tipo de llamada, o (desde la Fase 6) quién te escribió, **nunca el contenido de los mensajes**. Las suscripciones se guardan **cifradas** (permiten mandarle avisos a esa persona). Para evitar **SSRF**, solo se aceptan direcciones `https` de los servicios oficiales (Google, Mozilla, Apple, Microsoft). Se borran al cerrar sesión, al dar de baja la cuenta y cuando el navegador las cancela.

**Límites honestos de la Fase 4:**
- Las llamadas **no son E2EE**: el servidor de medios (que controlamos) podría técnicamente acceder al audio/video mientras pasa. LiveKit admite E2EE con claves compartidas; queda para la Fase 7.
- No se probó todavía con un servidor LiveKit real ni entre dos dispositivos (los tests usan un servidor de medios falso; la verificación de tokens y webhooks sí usa la librería real).
- En Chrome, si un aviso de "llamada atendida en otro dispositivo" llega sin mostrar nada, el navegador puede mostrar un aviso genérico ocasional.
- En iPhone las notificaciones solo funcionan con la app **instalada** (iOS 16.4 o superior).

## 2.4 Bloqueos y personas cercanas (Fase 5)

**Bloqueo:**
- Para quien fue bloqueado, quien lo bloqueó **"no existe"**: su perfil, agregarlo o abrir un chat responden igual que un tag inexistente, y desaparece de su agenda (sin borrar nada: al desbloquear vuelve todo).
- En un chat 1 a 1 ya existente **ninguno de los dos** puede escribir, mandar archivos ni llamar (ni atender una llamada que estaba sonando); el historial queda. El aviso es el mismo para los dos: no se revela quién bloqueó.
- En grupos: no se puede crear un grupo ni sumar a alguien con quien hay un bloqueo, y una llamada grupal no le suena. Dentro de un grupo existente se sigue pudiendo escribir (el grupo es de todos).
- Los estados y "Personas cercanas" aplican el bloqueo **dentro de la consulta SQL**, en las dos direcciones.

**Personas cercanas:**
- **Opt-in explícito**: la API exige `consent: true` en cada activación y la web muestra antes qué se comparte. Se apaga sola a los **60 minutos**; "Volverme invisible", pausar la cuenta o darla de baja **borran la zona**. Una limpieza cada 5 minutos borra las vencidas (las búsquedas ya las ignoran igual).
- **La ubicación exacta nunca llega al servidor**: el navegador la convierte en una celda de una grilla de ~1 km (`toNearbyCell`, en `packages/shared`) y solo envía fila y columna. La API rechaza cualquier pedido con coordenadas. En la base solo hay celdas; la auditoría registra "activó/desactivó", nunca dónde.
- **Distancias por rangos** (menos de 2, 2–5, 5–10 y 10–25 km), calculadas entre centros de celdas; dentro de cada rango el orden es al azar (no filtra distancias finas).
- **Qué se ve de alguien cercano:** nombre visible y foto. **Sin tag, bio, portada ni correo** hasta que acepte un saludo.
- **Reciprocidad:** para ver a otros tenés que estar visible (nadie mira sin ser visto).
- **Anti-triangulación:** cambiar de zona requiere 2 minutos desde el último cambio y hay un máximo de 20 cambios por día. Como mucho, alguien que falsee su ubicación puede averiguar **en qué celda de ~1 km** estás; nunca tu posición exacta.
- **Saludos:** solo a quien aparece en tu lista en ese momento; 20 por día; vencen a las 24 h; el rechazo no se informa (para quien saludó, el saludo simplemente vence).

**Límites honestos de la Fase 5:**
- La ubicación la informa el navegador: alguien puede **falsearla** (por ejemplo, con herramientas de desarrollador). Los límites de cambios lo hacen lento, pero con **varias cuentas** una persona decidida podría ubicar la celda de ~1 km de alguien visible. Por eso la visibilidad es temporal y opcional.
- En zonas poco pobladas, una celda de ~1 km puede identificar un barrio o una casa aislada. La pantalla de consentimiento lo advierte de forma general; conviene sumar una advertencia específica antes del lanzamiento.
- Que alguien desaparezca de tu agenda o de tus búsquedas puede hacerte sospechar un bloqueo: ninguna app puede ocultarlo del todo.
- No hay verificación de edad: definir una edad mínima (ver §5) es **obligatorio** antes de abrir esta función al público.

## 2.5 Silenciar, denuncias y panel de soporte (Fase 6)

**Avisos de mensajes y silenciar:**
- El aviso push de un mensaje nuevo **nunca incluye el texto** ni el archivo: solo quién escribió (o el nombre del grupo) y qué chat abrir. Con la app abierta y a la vista, el navegador no lo muestra.
- Silenciar es por persona y por chat (8 h, 1 semana o siempre) y vence solo. Las llamadas siempre suenan.

**Denuncias y evidencia:**
- Validación estricta (lista cerrada de motivos y campos). Quien denuncia **nunca se revela** a la persona denunciada, y quien denuncia solo ve si la denuncia "ya fue revisada" (no la decisión, para que no sirva como herramienta de presión).
- La evidencia la **elige quien denuncia** (hasta 10 mensajes o estados). La API solo acepta algo que esa persona **puede ver** (es miembro del chat, o el estado está vigente y visible para ella) y que **escribió la persona denunciada**. Si no, la denuncia entera se rechaza y no queda nada guardado.
- La evidencia es una **copia cifrada** (texto y archivo, con AAD propia `evidence:<id>`), no una referencia al chat: soporte **no tiene ningún camino** hacia la conversación original, y borrar el mensaje o que venza el estado no destruye la prueba.
- **Minimización:** al descartar una denuncia su evidencia se borra enseguida; la de denuncias resueltas se borra a los **180 días**.

**Panel de soporte (regla de seguridad 10):**
- El rol `support` se lee **de la base en cada petición**. A quien no es de soporte, todo `/support/*` le responde **404** (ni siquiera se revela que existe). Los archivos de evidencia (`/media/r/...`) exigen firma vigente **y** rol de soporte: ni quien denunció ni la persona denunciada pueden abrirlos.
- **No existe ninguna ruta que devuelva mensajes o conversaciones a soporte.** Las estadísticas son **solo conteos** (sin tags, ids ni correos). La ficha de una cuenta muestra el correo **enmascarado** (`j***@gmail.com`).
- Nadie de soporte resuelve denuncias o apelaciones **en las que es parte**. Resolver es atómico (dos personas a la vez no la resuelven dos veces).
- **Bajas:** 3 denuncias **confirmadas por soporte** de personas **distintas** (una persona que denuncia muchas veces cuenta una sola). La baja revoca sesiones, corta el tiempo real, la saca de "Cercanos", borra sus suscripciones push y le avisa por correo. El correo queda ocupado (no se puede registrar de nuevo).
- **Apelaciones:** ruta pública pero con **las mismas credenciales y el mismo bloqueo por intentos que el login**; mensaje cifrado; una pendiente a la vez y 30 días de espera tras un rechazo.
- **Reseteo asistido:** soporte solo dispara el mismo enlace de "Olvidé mi contraseña" **hacia el correo registrado**.
- **Roles:** se dan y quitan **solo por consola** (`npm run support:grant|revoke -- @tag`), con acceso al servidor. Ningún endpoint ni campo de perfil acepta `role`.
- **Auditoría:** denuncia creada, evidencia vista, confirmada/descartada, baja, reactivación, apelación creada/aceptada/rechazada, ficha consultada, reseteo asistido y cambios de rol.

**Límites honestos de la Fase 6:**
- Quien denuncia elige la evidencia: puede elegir mensajes fuera de contexto. Soporte decide con lo que tiene; por eso el umbral es de **3 personas distintas** y existe la apelación.
- Varias cuentas coordinadas podrían denunciar a alguien, pero cada denuncia la **confirma una persona de soporte** mirando la evidencia: no hay bajas automáticas.
- No hay todavía roles de soporte con distintos permisos (por ejemplo "moderación" vs. "administración"), ni doble aprobación para las bajas.
- La verificación de identidad para el reseteo asistido es un **procedimiento humano** que tenés que definir por escrito (qué datos se piden).

## 2.6 Endurecimiento: 2FA, llaves de acceso, anti-bots, límites compartidos y CSP (Fase 7A)

**Verificación en dos pasos (TOTP):**
- Algoritmo estándar (RFC 6238/4226, HMAC-SHA1, 6 dígitos, 30 s), verificado con los vectores oficiales de los RFC. Tolerancia de ±30 s por relojes corridos.
- El secreto se guarda **cifrado** (AES-256-GCM, AAD `totp:<id>`). El mismo código **no sirve dos veces** (se guarda el último paso usado, con actualización atómica en la base).
- **10 códigos de respaldo** de un solo uso, guardados solo como **HMAC con clave del servidor** (con un SHA-256 simple, una copia robada de la base permitiría probar todas las combinaciones de 40 bits).
- Login en dos pasos: tras la contraseña **no hay sesión**, solo un ticket JWT de 5 minutos en una cookie `HttpOnly`/`SameSite=Strict` limitada a `/auth`. Los códigos fallidos suman al **mismo bloqueo** que las contraseñas (5 intentos → 15 minutos): adivinar 6 dígitos no es viable.
- Activar exige contraseña + un primer código; desactivar o regenerar códigos exige **contraseña y un código vigente**. Cada cambio avisa por correo.
- **Soporte:** sin segundo factor, el panel responde `403 MFA_REQUIRED` (y los archivos de evidencia, "no encontrado").

**Llaves de acceso (WebAuthn):**
- Librería estándar `@simplewebauthn/server` 13.x. Solo se guarda la **clave pública**; la privada nunca sale del dispositivo. Sin attestation (no se piden datos del fabricante).
- La llave queda **atada al dominio** (rpID y origen verificados): una página falsa no puede usarla, a diferencia de un código TOTP que se puede tipear en un sitio de phishing.
- Desafío **de un solo uso**, cifrado y con 5 minutos de vida. El **contador** detecta llaves clonadas. Las respuestas del navegador se validan con un esquema Zod estricto antes de verificar la firma.
- Si es el primer segundo factor se entregan códigos de respaldo. Quitar la última llave (sin TOTP) desactiva el 2FA y borra esos códigos.
- Los tests usan un **autenticador por software** con claves P-256 reales, para ejercitar la verificación verdadera de la librería.

**Anti-bots (prueba de trabajo propia):**
- El servidor emite un desafío **firmado con HMAC** (propósito, dificultad, vencimiento de 5 minutos, valor al azar) sin guardar nada. El navegador busca un número tal que SHA-256 del desafío tenga N bits en cero (16 por defecto: ~1 s). La solución se recuerda hasta que vence: **no sirve dos veces**, ni para otro propósito, ni con la dificultad alterada.
- Aplica a registro, login, recuperación, reenvío de verificación y apelación. **En producción la API no arranca** sin ella (o con dificultad menor a 12).
- SHA-256 del navegador implementado en `packages/shared` (FIPS 180-4) para funcionar también sin HTTPS; los tests lo comparan contra el de Node y los vectores del NIST.
- **Límite honesto:** frena bots masivos y baratos, no a un atacante decidido con mucha capacidad de cómputo. Para eso están los límites por IP, el bloqueo por cuenta y (al desplegar) un WAF.

**Límites de peticiones compartidos:** el throttler guarda sus contadores en `KeyValueStore`. Sin `REDIS_URL`, en memoria (cada instancia cuenta aparte, con aviso en producción); con `REDIS_URL`, en **Redis** con un script Lua atómico y prefijo `qz:`. El adaptador de Redis **no se probó contra un Redis real** en los tests automáticos (se puede levantar con `npm run db:up`).

**CSP con nonce (web):**
- `src/proxy.ts` genera un nonce de 128 bits **por respuesta**. `script-src 'self' 'nonce-…' 'strict-dynamic'`: un script inyectado no tiene el nonce y no corre. Sin `'unsafe-eval'` en producción. `worker-src 'self'` explícito para el service worker.
- Verificado compilando y sirviendo la web: en `/login`, `/registro` y `/apelar` los **19 scripts** llevan el nonce correcto y cambia en cada respuesta.
- Costo: todas las páginas se renderizan en cada pedido (no hay HTML estático cacheable).
- **Límite honesto:** `style-src` sigue con `'unsafe-inline'` porque la interfaz usa atributos `style`. Sacarlo requiere mover esos estilos a clases y probarlo en un navegador.

## 3. Cómo funciona la recuperación de contraseña

- **Por correo:** `¿Olvidé mi contraseña?` → enlace de un solo uso, válido 1 hora → nueva contraseña (con la misma política) → todas las sesiones se cierran.
- **Por soporte técnico:** quien administra la app **no puede ver ni cambiar contraseñas** (solo existen hashes). El soporte atiende por correo (`soporte@qemzagram.com`, configurable en `AppHeader.tsx`) y, tras verificar la identidad por un procedimiento definido por vos, puede **iniciar el mismo proceso de restablecimiento** hacia el correo registrado desde **Panel de soporte → Cuentas** (Fase 6). Soporte nunca ve ni elige la contraseña.

## 4. Lo que NO está implementado todavía (importante)

| Tema | Situación | Plan |
|---|---|---|
| **Cifrado de extremo a extremo (E2EE)** | Hoy los mensajes están cifrados **en la base de datos** con una clave del servidor. Eso protege ante un robo de la base, pero **el servidor técnicamente podría descifrarlos**. Que "el soporte no pueda leerlos" hoy se cumple porque **no existe ninguna función ni endpoint** que lo permita, no por criptografía. | Fase 7: E2EE real (protocolo Signal/MLS) donde ni el servidor puede leer. Es un proyecto grande, con impacto en grupos, multi-dispositivo y copias de seguridad. |
| 2FA obligatorio para todas las cuentas | ✅ Opcional (TOTP, códigos de respaldo y llaves de acceso); obligatorio para soporte | Evaluar al lanzar |
| CAPTCHA más fuerte (Turnstile/hCaptcha) | ✅ Prueba de trabajo propia (§2.6) | Solo si aparecen bots sofisticados |
| Límite de peticiones compartido entre servidores | ✅ Redis con `REDIS_URL` (adaptador sin probar contra un Redis real en los tests) | Probar con el Redis del despliegue |
| CSP estricta en estilos | Scripts con nonce ✅; estilos con `'unsafe-inline'` | Pasar los atributos `style` a clases |
| WAF (firewall de aplicación) | No (es del hosting) | Al desplegar |
| Análisis antivirus de archivos adjuntos | ✅ Cliente ClamAV implementado y obligatorio en producción. En desarrollo puede quedar desactivado (aviso en consola) | Instalar `clamd` en el servidor |
| Almacenamiento externo de archivos (S3/R2) | Disco local cifrado detrás del puerto `BlobStorage` | Adaptador S3/R2 al elegir proveedor |
| Servidor de llamadas en producción | LiveKit en Docker solo para desarrollo | LiveKit propio (wss, credenciales propias, puertos UDP) o LiveKit Cloud |
| Llamadas E2EE | No (el servidor de medios es de confianza) | Fase 7 |
| Revisión de riesgos y legal de "Personas cercanas" | Diseño con celdas de 1 km, opt-in de 1 h y anti-rastreo (§2.4) | **Antes de abrirla al público** |
| Edad mínima / verificación de edad | No implementada | Antes de lanzar (especialmente "Personas cercanas") |
| Prueba de penetración externa | No realizada | **Obligatoria antes de lanzar** |
| Moderación con niveles de permiso / doble aprobación de bajas | Un solo rol `support` (ver §2.5) | Si el equipo crece |
| Copias de seguridad y recuperación ante desastres | Depende del hosting elegido | Despliegue |
| Gestor de secretos, rotación de claves | Solo variables de entorno | Despliegue |

## 4.1 Aviso sobre la ubicación (Fase 5)
Saber "quién está cerca" es una de las funciones más delicadas para la privacidad y la seguridad física de las personas. Está implementada **solo con consentimiento explícito (opt-in)**, **ubicación aproximada** (celdas de ~1 km; lo exacto nunca sale del dispositivo), modo invisible, vencimiento automático, bloqueo de usuarios y límites contra el rastreo (ver §2.4). Aun así, **no se recomienda lanzarla a público general sin una revisión específica de riesgos y legal** (la ubicación es un dato personal sensible según la Ley 25.326 y el RGPD) y sin definir una edad mínima.

## 5. Marco legal y normativo a considerar (asesoría profesional necesaria)

Esto es **orientación general, no asesoramiento legal**:

- **Argentina — Ley 25.326 de Protección de Datos Personales** (y su normativa complementaria): consentimiento informado, finalidad, calidad de los datos, **medidas de seguridad**, confidencialidad, derechos de **acceso, rectificación y supresión**, y **registro de la base de datos** ante la Agencia de Acceso a la Información Pública (AAIP). Hay novedades regulatorias recientes (adhesión al Convenio 108+); verificá la vigencia con un/a profesional.
- **Ley 26.388** (delitos informáticos) y obligaciones de cooperación con la justicia.
- **Menores de edad:** definir edad mínima de uso y consentimiento parental; ver normativa aplicable.
- **Si habrá usuarios en la UE:** RGPD (GDPR). **Si en EE. UU. (California):** CCPA/CPRA.
- **Documentos que necesitás redactar:** Términos y Condiciones, Política de Privacidad, Política de Cookies, procedimiento de **denuncias y bajas**, procedimiento de **respuesta a incidentes** (con plazos de notificación) y registro de tratamiento de datos.
- **Normas ISO de referencia:** ISO/IEC 27001 (gestión de seguridad), 27002 (controles), 27701 (privacidad), 27034 (seguridad de aplicaciones). Pueden usarse como guía aunque no se certifique.
- **Marcas:** verificar disponibilidad de "Qemzagram" en el INPI (clases 9 y 38) antes de invertir en publicidad.

## 6. Lista de verificación previa al lanzamiento

- [ ] Prueba de penetración externa y corrección de hallazgos
- [ ] HTTPS en todo (HSTS), dominio propio, SPF/DKIM/DMARC para los correos
- [ ] Base de datos gestionada con backups probados y cifrado en reposo
- [ ] Secretos en un gestor; plan de rotación de claves
- [ ] Almacenamiento externo para fotos y archivos (adaptador S3/R2 de `BlobStorage`)
- [ ] ClamAV (`clamd`) y ffmpeg instalados en el servidor, con firmas antivirus actualizadas
- [ ] 2FA activado en todas las cuentas de soporte; `POW_ENABLED=true` y `REDIS_URL` si hay más de una instancia
- [ ] WAF delante de la web y la API
- [ ] Términos, Privacidad y procedimiento de denuncias publicados
- [ ] Registro de la base de datos ante la AAIP (si corresponde)
- [ ] Monitoreo, alertas y plan de respuesta a incidentes
- [ ] Dependabot / `npm audit` en cada cambio (integración continua)
- [ ] Revisión legal de la función de ubicación
