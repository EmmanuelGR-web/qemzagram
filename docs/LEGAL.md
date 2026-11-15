# Documentos legales y protección de datos — Qemzagram

> ⚠️ **Esto es orientación general, no asesoramiento legal.** Los Términos y la Política de Privacidad de la app son **borradores**: describen con precisión cómo funciona Qemzagram hoy, pero tienen que pasar por un/a abogado/a especializado/a en datos personales antes de abrir el servicio al público. Las normas cambian (hay una reforma de la Ley 25.326 en discusión y la Argentina adhirió al Convenio 108+): verificá la vigencia de todo lo que sigue.

## 1. Qué hay en la app

| Pieza | Dónde |
|---|---|
| Términos y Condiciones | `/terminos` → `apps/web/src/app/(legal)/terminos/page.tsx` |
| Política de Privacidad | `/privacidad` → `apps/web/src/app/(legal)/privacidad/page.tsx` |
| Datos del responsable (a completar) | `apps/web/src/lib/legal.ts` |
| Edad mínima, versión de los textos, plazos | `packages/shared/src/constants.ts` (`MIN_AGE`, `LEGAL_VERSION`, `AUDIT_LOG_RETENTION_DAYS`) |
| Consentimiento | Casilla obligatoria en `/registro` ("Tengo 18 años o más y acepto…"). La API rechaza el registro sin `acceptTerms: true` y guarda `users.terms_version` y `users.terms_accepted_at`. |
| Retención | `RetentionService` (cada 6 h): borra la auditoría (que tiene IP) de más de 180 días y las sesiones vencidas. |

Las dos páginas son públicas (se leen con o sin sesión) y están enlazadas desde el registro y desde el menú (**Términos y privacidad**).

## 2. Antes de publicar: completá esto

1. **`apps/web/src/lib/legal.ts`**: reemplazá cada `[COMPLETAR: …]`:
   - `responsible`, `taxId` y `address`: quién es responsable de los datos. Si "Neoematech" no es una sociedad registrada, **el responsable sos vos como persona humana** (nombre, CUIL y domicilio).
   - `jurisdiction`: tribunales competentes (consultalo; en relaciones de consumo la persona usuaria puede litigar en su domicilio).
   - `mailProvider`: el proveedor SMTP que contrates (ver `docs/DESPLIEGUE.md` §4).
   - `aaipRegistration`: el número que te den al inscribir la base (§3).
   - `supportEmail` y `privacyEmail`: casillas que **existan y leas**. Los pedidos de acceso tienen plazo legal (10 días corridos) y los de rectificación o supresión, 5 días hábiles.
2. **Región de Backblaze B2**: la Política dice que algunos proveedores están fuera de la Argentina "por ejemplo, en los Estados Unidos". Si elegís la región europea, ajustá el texto.
3. **Revisión de un/a abogado/a**: los dos textos completos, con atención especial a la **transferencia internacional** (Ley 25.326, art. 12: Estados Unidos no figura entre los países con protección "adecuada"; la Política se apoya en el consentimiento expreso y en el cifrado previo de los archivos), la limitación de responsabilidad (Ley 24.240) y la jurisdicción.

**Cada vez que cambies un texto legal:** actualizá `LEGAL_VERSION` (fecha `AAAA-MM-DD`). Las cuentas nuevas guardan la versión que aceptaron. Si el cambio es importante, hay que volver a pedir la aceptación (ver pendientes, §5).

**Si cambiás el funcionamiento** (edad, plazos, proveedores, qué se borra en la baja, denuncias), actualizá los textos en el mismo commit. Los plazos que dependen de constantes (`AUDIT_LOG_RETENTION_DAYS`, `REPORT_EVIDENCE_RETENTION_DAYS`, `MIN_AGE`) se actualizan solos en las páginas.

## 3. Inscripción de la base de datos ante la AAIP

La Ley 25.326 (art. 21) obliga a inscribir en el **Registro Nacional de Bases de Datos** toda base de datos personales destinada a dar información a terceros, y en la práctica la Agencia de Acceso a la Información Pública (AAIP) pide inscribir las bases privadas como la de Qemzagram. El trámite, según la información pública de la AAIP (verificala en <https://www.argentina.gob.ar/aaip/datospersonales>):

1. **Es gratuito** y se hace en línea por **Trámites a Distancia (TAD)**: <https://tramitesadistancia.gob.ar>, con tu CUIT/CUIL y Clave Fiscal de AFIP/ARCA.
2. Buscá el trámite de **inscripción de bases de datos personales** (persona humana o jurídica privada, según corresponda).
3. Vas a necesitar describir la base. Esto te sirve de borrador:

| Campo | Qemzagram |
|---|---|
| Nombre de la base | Usuarios de Qemzagram |
| Finalidad | Prestación de un servicio de mensajería: gestión de cuentas, comunicación entre usuarios, seguridad y moderación |
| Datos | Identificatorios (correo, tag, nombre visible, foto); contenido de comunicaciones cifrado; ubicación aproximada (celda de ~1 km, opcional, 60 min); datos técnicos (IP, navegador) |
| Datos sensibles | No se recaban a propósito. La ubicación aproximada es opcional y temporal. El contenido de los mensajes podría incluir datos sensibles que escriban los usuarios: está cifrado y nadie del equipo puede leerlo |
| Origen | Las propias personas usuarias |
| Cesiones | No hay. Encargados de tratamiento: Oracle Cloud (hosting), Backblaze (almacenamiento de archivos cifrados y backups), proveedor de correo |
| Transferencias internacionales | Sí: servidores de proveedores en el exterior (EE. UU.); con consentimiento expreso y cifrado previo |
| Medidas de seguridad | Ver `docs/SEGURIDAD.md` (cifrado AES-256-GCM, E2EE opcional, Argon2id, HTTPS, auditoría, backups cifrados, control de acceso por roles) |
| Plazo de conservación | Mientras exista la cuenta; auditoría 180 días; sesiones hasta su vencimiento; evidencia de denuncias hasta 180 días |

4. Cuando te den el número de inscripción, ponelo en `LEGAL.aaipRegistration`.
5. Consultá si hace falta **renovar o actualizar** la inscripción cuando cambie la base (proveedores, finalidad, datos).

## 4. Otras obligaciones a tener en cuenta

- **Atender los derechos de acceso, rectificación y supresión** en plazo: acceso en 10 días corridos (art. 14) y rectificación o supresión en 5 días hábiles (art. 16). Definí por escrito cómo verificás la identidad (por ejemplo, que el pedido venga del correo registrado).
- **Incidentes de seguridad**: tené un procedimiento para avisar a las personas afectadas y a la AAIP (ver `docs/DESPLIEGUE.md` §13, "Si algo sale mal").
- **Material de abuso sexual infantil**: los Términos dicen que se informa a las autoridades. Definí el procedimiento (en Argentina, por ejemplo, ante el Ministerio Público Fiscal o la unidad especializada que corresponda) y no guardes ni reenvíes el material fuera de lo necesario para la denuncia.
- **Pedidos judiciales**: solo con orden de autoridad competente. Recordá que soporte no puede leer conversaciones y que en los chats con E2EE nadie puede.
- **Marca**: verificá "Qemzagram" en el INPI (clases 9 y 38) antes de invertir en difusión.

## 5. Pendientes (lo que los textos prometen y el código todavía no tiene)

| Tema | Situación | Qué haría falta |
|---|---|---|
| Volver a aceptar tras un cambio importante | Se guarda la versión aceptada, pero no hay pantalla para pedir una nueva aceptación | Comparar `terms_version` con `LEGAL_VERSION` al iniciar sesión y mostrar los cambios |
| Cuentas anteriores a los textos | Tienen `terms_version` nulo | Pedirles la aceptación con lo anterior |
| Exportar mis datos (derecho de acceso) | Se atiende por correo, a mano | Botón "Descargar mis datos" en Ajustes |
| Baja directa por soporte (menores, orden judicial, abuso infantil) | Hoy la baja solo ocurre con 3 denuncias confirmadas; una baja inmediata requiere acceso al servidor | Acción de soporte con motivo obligatorio y auditoría (idealmente con doble aprobación) |
| Verificación de edad | Solo declaración en la casilla | Evaluar con un/a abogado/a si alcanza |
| Borrar un mensaje enviado | No existe | Función "eliminar para todos" (también reduce lo que queda tras una baja) |
