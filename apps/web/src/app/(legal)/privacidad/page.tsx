import { AUDIT_LOG_RETENTION_DAYS, LEGAL_VERSION, MIN_AGE, REPORT_EVIDENCE_RETENTION_DAYS } from '@qemzagram/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Política de Privacidad' };

/**
 * BORRADOR conforme a la Ley 25.326. Cada dato y plazo de esta página tiene que coincidir con lo que hace
 * el código (ver docs/SEGURIDAD.md). Los plazos salen de las constantes de packages/shared para no desfasarse.
 */
export default function PrivacyPage() {
  const auditMonths = Math.round(AUDIT_LOG_RETENTION_DAYS / 30);
  return (
    <article>
      <h1>Política de Privacidad de Qemzagram</h1>
      <p className="legal-updated">Versión {LEGAL_VERSION}</p>

      <p className="legal-box">
        <strong>En pocas palabras:</strong> pedimos lo mínimo (correo, tag y contraseña; nunca tu teléfono). Tus mensajes y archivos se guardan
        cifrados y, con el cifrado de extremo a extremo, ni nosotros podemos leerlos. No vendemos tus datos, no mostramos publicidad y no
        usamos herramientas de seguimiento.
      </p>

      <h2>1. Responsable de tus datos</h2>
      <p>
        El responsable de la base de datos es <strong>{LEGAL.responsible}</strong> (CUIT/CUIL {LEGAL.taxId}), con domicilio en {LEGAL.address}.
        Para cualquier consulta sobre tus datos escribinos a <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. Inscripción
        ante la Agencia de Acceso a la Información Pública: {LEGAL.aaipRegistration}.
      </p>

      <h2>2. Qué datos tratamos y para qué</h2>
      <table>
        <thead>
          <tr>
            <th>Dato</th>
            <th>Para qué</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Correo electrónico (verificado)</td>
            <td>Identificar tu cuenta (una por correo), verificarla, recuperar la contraseña y avisarte de cambios de seguridad.</td>
          </tr>
          <tr>
            <td>Tag (@usuario) y nombre visible</td>
            <td>Que otras personas te encuentren y te agreguen a su agenda.</td>
          </tr>
          <tr>
            <td>Contraseña</td>
            <td>
              Iniciar sesión. <strong>Nunca la guardamos</strong>: solo una huella irreversible (Argon2id). Nadie del equipo puede verla.
            </td>
          </tr>
          <tr>
            <td>Foto de perfil, portada, biografía y privacidad del perfil (opcionales)</td>
            <td>Mostrar tu perfil. Si es privado, la bio y la portada solo las ven tus contactos.</td>
          </tr>
          <tr>
            <td>Agenda de contactos (los tags que agregás) y bloqueos</td>
            <td>Permitir chats y grupos solo con personas de tu agenda, y aplicar los bloqueos.</td>
          </tr>
          <tr>
            <td>Mensajes, fotos, videos, notas de voz, documentos y stickers</td>
            <td>Entregarlos a las personas del chat. Se guardan cifrados (ver punto 4).</td>
          </tr>
          <tr>
            <td>Estados de 24 horas y quién los vio</td>
            <td>Mostrarlos a quienes elegiste. Se borran a las 24 horas.</td>
          </tr>
          <tr>
            <td>Registro de llamadas (quién llamó, en qué chat, cuándo y cuánto duró)</td>
            <td>Mostrar el historial de llamadas. El audio y el video <strong>nunca se graban</strong>.</td>
          </tr>
          <tr>
            <td>Zona aproximada en “Personas cercanas” (solo si la activás)</td>
            <td>
              Mostrarte personas cerca. Tu ubicación exacta <strong>nunca sale de tu dispositivo</strong>: solo enviamos una celda de una
              grilla de unos 1 km, que se borra sola a los 60 minutos o cuando te volvés invisible.
            </td>
          </tr>
          <tr>
            <td>Suscripción a notificaciones (solo si las activás)</td>
            <td>Avisarte de mensajes y llamadas. El aviso dice quién te escribió, nunca el contenido.</td>
          </tr>
          <tr>
            <td>Dirección IP, navegador y fecha de inicio de sesión</td>
            <td>Seguridad: detectar accesos indebidos, frenar ataques y registrar eventos sensibles (auditoría).</td>
          </tr>
          <tr>
            <td>Datos de verificación en dos pasos y llaves de acceso (opcionales)</td>
            <td>Proteger tu cuenta. El secreto se guarda cifrado; de las llaves de acceso solo guardamos la parte pública.</td>
          </tr>
          <tr>
            <td>Denuncias y la evidencia que elige quien denuncia; apelaciones</td>
            <td>Moderar el servicio (ver punto 6).</td>
          </tr>
          <tr>
            <td>Fecha y versión de los Términos y de esta Política que aceptaste</td>
            <td>Poder demostrar tu consentimiento.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Brindar el correo, el tag y la contraseña es <strong>obligatorio</strong> para tener una cuenta; sin ellos no podemos prestarte el
        servicio. Todo lo demás es opcional. <strong>No</strong> pedimos tu número de teléfono, tu nombre real ni tu documento. No usamos tus
        datos para publicidad ni para crear perfiles comerciales, y no tomamos decisiones automáticas sobre vos: toda baja la decide una
        persona.
      </p>

      <h2>3. Qué guarda tu navegador</h2>
      <ul>
        <li>
          <strong>Cookies técnicas</strong>, imprescindibles para mantener tu sesión de forma segura (<code>qz_at</code>, <code>qz_rt</code> y,
          durante la verificación en dos pasos, <code>qz_mfa</code>). No usamos cookies de publicidad ni de analítica.
        </li>
        <li>
          <strong>Almacenamiento local</strong>: tus preferencias de apariencia y, si activás el cifrado de extremo a extremo, tu clave privada,
          guardada de forma que ni siquiera un programa en la página pueda copiarla.
        </li>
      </ul>

      <h2>4. Cómo protegemos tus datos</h2>
      <ul>
        <li>Toda la comunicación viaja por HTTPS.</li>
        <li>
          Los mensajes y archivos se guardan <strong>cifrados</strong> (AES-256). A las fotos, videos y notas de voz les quitamos los
          metadatos, por ejemplo la ubicación GPS que agregan los celulares, y los archivos se analizan con antivirus.
        </li>
        <li>
          Con el <strong>cifrado de extremo a extremo</strong> activado por todas las personas de un chat, los mensajes, archivos y llamadas se
          cifran en tu dispositivo y <strong>nadie más</strong> puede leerlos, ni siquiera nosotros. Aun así vemos algunos datos técnicos: quién
          habla con quién, cuándo y el tamaño de los mensajes.
        </li>
        <li>
          El equipo de soporte <strong>no tiene ninguna forma de leer conversaciones</strong>. Solo ve la evidencia que elige quien denuncia y
          estadísticas sin datos personales.
        </li>
        <li>Las copias de seguridad se hacen todos los días y se guardan cifradas.</li>
      </ul>
      <p>
        Ningún sistema es 100% seguro. Si ocurriera un incidente que afecte tus datos, te avisaremos y lo informaremos a la autoridad según
        corresponda.
      </p>

      <h2>5. Con quién compartimos datos</h2>
      <p>
        <strong>No vendemos ni cedemos tus datos.</strong> Para funcionar usamos proveedores que los procesan por cuenta nuestra y solo para
        prestar el servicio:
      </p>
      <ul>
        <li>
          <strong>Oracle Cloud</strong>: el servidor donde funciona Qemzagram, con la base de datos, las llamadas y el antivirus.
        </li>
        <li>
          <strong>Backblaze B2</strong>: guarda los archivos adjuntos y las copias de seguridad. Les llegan <strong>ya cifrados</strong>: el
          proveedor no puede ver su contenido, su nombre ni su tipo.
        </li>
        <li>
          <strong>{LEGAL.mailProvider}</strong>: envía los correos de verificación, recuperación y avisos de seguridad (recibe tu dirección de
          correo).
        </li>
        <li>
          <strong>Servicios de notificaciones de tu navegador</strong> (Google, Mozilla, Apple o Microsoft, según cuál uses), solo si activás
          las notificaciones. El aviso viaja cifrado.
        </li>
      </ul>
      <p>
        Algunos de estos proveedores tienen servidores <strong>fuera de la Argentina</strong> (por ejemplo, en los Estados Unidos). Al aceptar
        esta Política prestás tu consentimiento expreso para esa transferencia internacional, que hacemos con las medidas de seguridad
        descriptas, entre ellas el cifrado previo de los archivos. Además, solo entregaremos datos a una autoridad cuando lo exija una orden
        judicial o la ley.
      </p>

      <h2>6. Denuncias</h2>
      <p>
        Si alguien denuncia contenido, guardamos una <strong>copia cifrada de la evidencia que eligió</strong> (hasta 10 mensajes o estados
        que escribió la persona denunciada). Si la denuncia se descarta, esa evidencia se borra enseguida; si se resuelve, se borra a los{' '}
        {REPORT_EVIDENCE_RETENTION_DAYS} días. Nunca le revelamos a la persona denunciada quién la denunció.
      </p>

      <h2>7. Cuánto tiempo guardamos los datos</h2>
      <ul>
        <li>
          <strong>Tu cuenta y tu contenido</strong>: mientras la cuenta exista. Los estados se borran a las 24 horas y la zona de “Personas
          cercanas”, a los 60 minutos.
        </li>
        <li>
          <strong>Registro de seguridad (con IP)</strong>: {AUDIT_LOG_RETENTION_DAYS} días (unos {auditMonths} meses). Después se borra
          automáticamente.
        </li>
        <li>
          <strong>Sesiones</strong> (con IP y navegador): se borran cuando vencen.
        </li>
        <li>
          <strong>Copias de seguridad</strong>: se renuevan solas. Un dato borrado puede seguir en una copia cifrada hasta que esa copia se
          elimine.
        </li>
      </ul>
      <h3>Qué pasa cuando das de baja tu cuenta</h3>
      <p>
        Se borran tu foto, tu portada, tus estados, tus claves de cifrado, tus suscripciones a notificaciones, tus bloqueos y tu zona de
        “Personas cercanas”. Tu correo, tag, nombre y biografía se reemplazan por datos anónimos y se cierran todas tus sesiones. Los{' '}
        <strong>mensajes que ya enviaste siguen en los chats de las otras personas</strong>, que los recibieron, pero aparecen firmados como
        “Cuenta eliminada”. El registro de seguridad se conserva hasta cumplir su plazo.
      </p>

      <h2>8. Tus derechos</h2>
      <p>Según la Ley 25.326 de Protección de Datos Personales, tenés derecho a:</p>
      <ul>
        <li>
          <strong>Acceder</strong> a tus datos: pedilo a <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a> y te respondemos en
          un plazo máximo de 10 días corridos.
        </li>
        <li>
          <strong>Rectificarlos</strong>: podés cambiar tu nombre, foto, portada, bio y privacidad desde tu perfil, o pedirlo por correo.
        </li>
        <li>
          <strong>Suprimirlos</strong>: podés dar de baja tu cuenta desde Ajustes o pedirlo por correo. Las solicitudes de rectificación y
          supresión se resuelven en un plazo máximo de 5 días hábiles.
        </li>
        <li>
          <strong>Retirar tu consentimiento</strong> para lo opcional: desactivar “Personas cercanas”, las notificaciones o borrar tu foto en
          cualquier momento.
        </li>
      </ul>
      <p>Para proteger tu cuenta, podemos pedirte que acredites tu identidad, por ejemplo, escribiendo desde el correo registrado.</p>
      <p className="legal-box">
        El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no
        inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la
        Ley N° 25.326. La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la
        atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las
        normas vigentes en materia de protección de datos personales.
      </p>

      <h2>9. Edad mínima</h2>
      <p>
        Qemzagram es solo para personas de <strong>{MIN_AGE} años o más</strong>. No recopilamos a sabiendas datos de menores; si detectamos
        una cuenta de una persona menor, la damos de baja.
      </p>

      <h2>10. Cambios en esta Política</h2>
      <p>
        Si cambiamos esta Política, publicaremos la nueva versión con su fecha y te avisaremos antes de que se aplique. Ver también los{' '}
        <Link href="/terminos">Términos y Condiciones</Link>.
      </p>
    </article>
  );
}
