# Hoja de ruta de Qemzagram

Construir todo de golpe sería la mejor receta para tener errores de seguridad. Por eso el proyecto avanza por fases: cada una se prueba y se revisa antes de seguir.

## ✅ Fase 1 — Base segura
Cuentas con correo verificado y tag, contraseña segura, recuperación, perfil con foto y portada (público/privado), agenda por tag, chats y grupos (hasta 10) en tiempo real con mensajes cifrados en la base, ajustes de apariencia y privacidad, pausar/dar de baja la cuenta, menú móvil fijo + desplegable.

## ✅ Fase 2 — Contenido multimedia en el chat
- ✅ Imágenes (cámara del celular o galería), videos, notas de voz y documentos adjuntos, con epígrafe opcional.
- ✅ **URLs firmadas con vencimiento** + sesión y membresía, límites de tamaño, validación de contenido real, **antivirus ClamAV** (obligatorio en producción), eliminación de metadatos (ffmpeg para audio y video) y cifrado de los archivos en reposo.
- ✅ **Stickers:** pack general de 12 stickers originales + stickers propios (imagen → WebP 512×512) en "Mis stickers".
- 🔜 Pendiente para producción: adaptador de almacenamiento externo S3/R2 (hoy: disco local detrás del puerto `BlobStorage`). Ver `SEGURIDAD.md` §2.1.

## Fase 3 — Estados (24 horas)
- Publicar foto/video/texto con vencimiento automático.
- Control de **quién puede verlos y quién no** (lista de excluidos / solo agenda), ya reservado en Ajustes.

## Fase 4 — Llamadas y videollamadas
- **WebRTC**: llamadas 1 a 1 entre dos usuarios.
- Grupos de hasta 10 personas: requieren un servidor **SFU** (por ejemplo LiveKit o mediasoup); la conexión directa entre todos no escala a 10 participantes. Incluye servidor TURN para atravesar redes restrictivas.
- Notificaciones push (PWA/FCM) para llamadas entrantes.

## Fase 5 — Personas cercanas
- **Solo con consentimiento explícito (opt-in)**, ubicación **aproximada** (nunca coordenadas exactas), modo invisible, bloqueo de usuarios y límites contra rastreo por triangulación.
- Requiere revisión específica de riesgos y de privacidad antes de abrirla al público.

## Fase 6 — Soporte, denuncias y estadísticas
- Rol **soporte** con panel **sin acceso a conversaciones**: estadísticas agregadas de uso, gestión de denuncias y bajas.
- Sistema de **denuncias** (spam, hostigamiento, etc.): al acumular denuncias válidas, baja total del usuario y de su correo, con registro y posibilidad de apelación. La persona que denuncia puede adjuntar el contenido ofensivo como evidencia.
- Restablecimiento de contraseña asistido por soporte (verificación de identidad + envío del enlace al correo registrado).
- Bloquear / silenciar usuarios.

## Fase 7 — Cifrado de extremo a extremo y endurecimiento
- **E2EE real** (Signal / MLS): ni el servidor ni el soporte pueden leer los mensajes. Implica manejo de claves por dispositivo, grupos y copias de seguridad cifradas.
- 2FA (TOTP / llaves de seguridad), CAPTCHA, CSP con nonce, Redis para límites compartidos, ClamAV, WAF.
- **Prueba de penetración externa.**

## Despliegue y operación (en paralelo)
- Integración continua (tests + `npm audit` en cada cambio), Dependabot.
- Dockerfiles de producción, hosting con HTTPS, backups probados, monitoreo y alertas.
- Documentos legales (Términos, Privacidad) y registro de base de datos ante la AAIP.
