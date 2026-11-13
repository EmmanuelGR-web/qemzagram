# Hoja de ruta de Qemzagram

Construir todo de golpe sería la mejor receta para tener errores de seguridad. Por eso el proyecto avanza por fases: cada una se prueba y se revisa antes de seguir.

## ✅ Fase 1 — Base segura
Cuentas con correo verificado y tag, contraseña segura, recuperación, perfil con foto y portada (público/privado), agenda por tag, chats y grupos (hasta 10) en tiempo real con mensajes cifrados en la base, ajustes de apariencia y privacidad, pausar/dar de baja la cuenta, menú móvil fijo + desplegable.

## ✅ Fase 2 — Contenido multimedia en el chat
- ✅ Imágenes (cámara del celular o galería), videos, notas de voz y documentos adjuntos, con epígrafe opcional.
- ✅ **URLs firmadas con vencimiento** + sesión y membresía, límites de tamaño, validación de contenido real, **antivirus ClamAV** (obligatorio en producción), eliminación de metadatos (ffmpeg para audio y video) y cifrado de los archivos en reposo.
- ✅ **Stickers:** pack general de 12 stickers originales + stickers propios (imagen → WebP 512×512) en "Mis stickers".
- 🔜 Pendiente para producción: adaptador de almacenamiento externo S3/R2 (hoy: disco local detrás del puerto `BlobStorage`). Ver `SEGURIDAD.md` §2.1.

## ✅ Fase 3 — Estados (24 horas)
- ✅ Estados de **texto** (con fondos de una lista cerrada), **foto** y **video** (hasta 60 s), con epígrafe opcional. Cámara dentro de la app o galería.
- ✅ **Vencimiento automático a las 24 h:** toda consulta ignora lo vencido y una limpieza periódica borra filas y archivos.
- ✅ **Quién puede verlos:** "Mi agenda", "Mi agenda excepto…" o "Solo compartir con…" (siempre limitado a contactos **mutuos**). El cambio rige al instante, también para los estados ya publicados.
- ✅ **Visto por** (solo lo ve el dueño), borrar un estado antes de que venza, aviso en **tiempo real** a la audiencia y borrado inmediato al dar de baja la cuenta.
- Texto cifrado en la base y archivos cifrados en reposo, con el mismo pipeline de seguridad de la Fase 2. Ver `SEGURIDAD.md` §2.2.

## ✅ Fase 4 — Llamadas y videollamadas
- ✅ **LiveKit (SFU) para todas las llamadas**, 1 a 1 y grupos de hasta 10: un solo camino de código, nadie ve la IP de nadie y trae TURN incluido. Detrás del puerto `CallMediaPort` (en los tests, uno falso).
- ✅ Llamada de voz o video desde cualquier chat; llamada entrante con timbre; silenciar, apagar/cambiar cámara y cortar. Una sola llamada en curso por chat; "perdida" a los 45 s; máximo 4 h.
- ✅ Grupos: grilla de participantes y **"Unirme"** a una llamada en curso.
- ✅ Registro en el chat: "Llamada perdida", "Videollamada · 3:12", "rechazada", "cancelada".
- ✅ **Webhook firmado** de LiveKit: si alguien cierra el navegador, la llamada se actualiza sola.
- ✅ **Notificaciones push** (Web Push estándar con VAPID, sin Firebase) de llamadas entrantes y perdidas, con la app cerrada.
- 🔜 Para producción: servidor LiveKit propio con `wss://` y credenciales propias (o LiveKit Cloud), con los puertos de medios abiertos. Ver `SEGURIDAD.md` §2.3.

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
