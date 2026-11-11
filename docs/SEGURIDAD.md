# Seguridad y cumplimiento — Qemzagram

Este documento dice **qué está implementado, qué no, y qué falta** para operar de forma responsable. Está escrito a propósito sin exageraciones: en seguridad, saber lo que *no* se cubre es tan importante como lo que sí.

## 1. Lo que hay que tener claro

1. **No existe el software sin errores.** Lo que sí se puede hacer es reducir el riesgo con buenas prácticas, pruebas, revisión de dependencias, auditorías externas y monitoreo continuo. Esta base ya cuenta con 22 pruebas automáticas de seguridad y 0 vulnerabilidades conocidas en las dependencias de producción (`npm run audit`), pero eso se debe **repetir en cada cambio**.
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
| **A10 SSRF** | La API no realiza peticiones a URLs provistas por usuarios. |

Otros controles: protección **CSRF** (verificación de `Origin` + cookies `SameSite=Strict`), **límite de tamaño** de cuerpos y de imágenes (5 MB, 40 megapíxeles), **validación del contenido real** de las imágenes (no de la extensión), re-codificación a WebP (elimina EXIF/GPS y código oculto), nombres de archivo aleatorios, `X-Content-Type-Options: nosniff`.

## 3. Cómo funciona la recuperación de contraseña

- **Por correo:** `¿Olvidé mi contraseña?` → enlace de un solo uso, válido 1 hora → nueva contraseña (con la misma política) → todas las sesiones se cierran.
- **Por soporte técnico:** quien administra la app **no puede ver ni cambiar contraseñas** (solo existen hashes). El soporte atiende por correo (`soporte@qemzagram.com`, configurable en `AppHeader.tsx`) y, tras verificar la identidad por un procedimiento definido por vos, puede **iniciar el mismo proceso de restablecimiento** hacia el correo registrado. El panel de soporte con esa acción se construye en la Fase 6.

## 4. Lo que NO está implementado todavía (importante)

| Tema | Situación | Plan |
|---|---|---|
| **Cifrado de extremo a extremo (E2EE)** | Hoy los mensajes están cifrados **en la base de datos** con una clave del servidor. Eso protege ante un robo de la base, pero **el servidor técnicamente podría descifrarlos**. Que "el soporte no pueda leerlos" hoy se cumple porque **no existe ninguna función ni endpoint** que lo permita, no por criptografía. | Fase 7: E2EE real (protocolo Signal/MLS) donde ni el servidor puede leer. Es un proyecto grande, con impacto en grupos, multi-dispositivo y copias de seguridad. |
| Verificación en dos pasos (2FA/TOTP) | No | Fase de endurecimiento |
| CAPTCHA / anti-bots en registro | No (solo límites de peticiones) | Fase de endurecimiento |
| Límite de peticiones compartido entre servidores | Es en memoria (1 instancia) | Redis al escalar |
| CSP estricta con *nonce* en la web | Usa `'unsafe-inline'` por requisito de Next.js sin nonces | Middleware con nonce |
| Análisis antivirus de archivos adjuntos | Aún no hay adjuntos | Fase 2 (ClamAV) |
| Prueba de penetración externa | No realizada | **Obligatoria antes de lanzar** |
| Moderación, denuncias y bajas por incumplimiento | Esquema preparado (`status: banned`, rol `support`) | Fase 6 |
| Copias de seguridad y recuperación ante desastres | Depende del hosting elegido | Despliegue |
| Gestor de secretos, rotación de claves | Solo variables de entorno | Despliegue |

## 4.1 Aviso sobre la ubicación (Fase 5)
Saber "quién está cerca" es una de las funciones más delicadas para la privacidad y la seguridad física de las personas. Se diseñará **solo con consentimiento explícito (opt-in)**, **ubicación aproximada** (nunca coordenadas exactas), posibilidad de ocultarse, bloqueo de usuarios y límites para evitar rastreo (*triangulación*). Se recomienda no lanzarla a público general sin una revisión específica de riesgos.

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
- [ ] Almacenamiento externo para fotos y archivos
- [ ] 2FA y CAPTCHA activados
- [ ] Términos, Privacidad y procedimiento de denuncias publicados
- [ ] Registro de la base de datos ante la AAIP (si corresponde)
- [ ] Monitoreo, alertas y plan de respuesta a incidentes
- [ ] Dependabot / `npm audit` en cada cambio (integración continua)
- [ ] Revisión legal de la función de ubicación
