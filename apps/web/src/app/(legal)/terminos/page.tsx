import { LEGAL_VERSION, MIN_AGE } from '@qemzagram/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Términos y Condiciones' };

/**
 * BORRADOR. Describe el funcionamiento REAL de la app: si cambiás algo de lo que se describe acá
 * (edad, denuncias, cifrado, bajas), actualizá el texto y subí LEGAL_VERSION en packages/shared.
 */
export default function TermsPage() {
  return (
    <article>
      <h1>Términos y Condiciones de Qemzagram</h1>
      <p className="legal-updated">Versión {LEGAL_VERSION}</p>

      <h2>1. Qué son estos términos</h2>
      <p>
        Estos Términos regulan el uso de Qemzagram, una aplicación de mensajería que funciona sin número de teléfono. Al crear una cuenta
        declarás que los leíste y los aceptás, junto con la <Link href="/privacidad">Política de Privacidad</Link>. Guardamos la fecha y la
        versión que aceptaste. Si no estás de acuerdo, no uses el servicio.
      </p>

      <h2>2. Quién presta el servicio</h2>
      <p>
        Qemzagram (by Neoematech) es prestado por <strong>{LEGAL.responsible}</strong>, CUIT/CUIL {LEGAL.taxId}, con domicilio en{' '}
        {LEGAL.address}. Contacto: <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>.
      </p>

      <h2>3. Requisitos para tener una cuenta</h2>
      <ul>
        <li>
          Tener <strong>{MIN_AGE} años o más</strong>. Lo declarás al registrarte. Si nos enteramos de que una cuenta pertenece a una persona
          menor, la daremos de baja.
        </li>
        <li>Un correo electrónico propio y verificado. Se permite una sola cuenta por correo.</li>
        <li>
          Cuidar tu contraseña, tus códigos de verificación en dos pasos y tu código de recuperación del cifrado. Sos responsable de lo que
          se haga desde tu cuenta si no los protegés.
        </li>
        <li>No hacerte pasar por otra persona ni elegir un tag que confunda (por ejemplo, el nombre de una marca o de un organismo).</li>
      </ul>

      <h2>4. Cómo es el servicio</h2>
      <p>
        Qemzagram es <strong>gratuito</strong> y está en una etapa inicial. Lo ofrecemos “tal como está”: hacemos lo posible para que funcione
        bien y sea seguro, pero no podemos garantizar que esté siempre disponible ni libre de errores. Podemos cambiar, agregar o quitar
        funciones. Si un cambio afecta tus datos, te avisaremos con anticipación razonable.
      </p>

      <h2>5. Qué no se puede hacer</h2>
      <p>Al usar Qemzagram te comprometés a no:</p>
      <ul>
        <li>
          Compartir material de abuso o explotación sexual de menores. <strong>Tolerancia cero:</strong> además de dar de baja la cuenta, lo
          informaremos a las autoridades competentes.
        </li>
        <li>Acosar, amenazar, extorsionar, discriminar o incitar a la violencia contra otras personas.</li>
        <li>Difundir imágenes íntimas o datos personales de otra persona sin su consentimiento.</li>
        <li>Enviar spam, estafas, cadenas, publicidad no pedida o archivos con virus.</li>
        <li>
          Falsear tu ubicación en “Personas cercanas” para seguir o ubicar a alguien, o usar cualquier función para vigilar a otra persona.
        </li>
        <li>
          Intentar vulnerar la seguridad del servicio, acceder a cuentas ajenas, usar bots o programas automáticos, o copiar datos de otras
          personas de forma masiva.
        </li>
        <li>Usar Qemzagram para cualquier actividad ilegal según las leyes de la República Argentina.</li>
      </ul>

      <h2>6. Tu contenido</h2>
      <p>
        Lo que escribís y compartís (mensajes, fotos, videos, notas de voz, documentos, estados y stickers) <strong>es tuyo</strong>. Solo nos
        das permiso para guardarlo, procesarlo (por ejemplo, quitarle los metadatos a una foto) y entregárselo a las personas que elegiste,
        con el único fin de prestar el servicio. No vendemos tu contenido ni lo usamos para publicidad. Sos responsable de tener derecho a
        compartir lo que compartís.
      </p>

      <h2>7. Cifrado y código de recuperación</h2>
      <p>
        Los mensajes y archivos se guardan cifrados. Si activás el <strong>cifrado de extremo a extremo</strong>, en los chats donde todas las
        personas lo activaron ni nosotros podemos leer los mensajes, los archivos ni las llamadas. En ese caso, tu historial cifrado depende de
        tu <strong>código de recuperación</strong>: si lo perdés, <strong>nadie puede recuperarlo</strong>, ni siquiera nosotros. Los
        detalles y los límites del cifrado están en la <Link href="/privacidad">Política de Privacidad</Link>.
      </p>

      <h2>8. Denuncias, bajas y apelaciones</h2>
      <ul>
        <li>
          Podés denunciar mensajes o estados desde la app y elegir hasta 10 como evidencia. Quien denuncia nunca se revela a la persona
          denunciada.
        </li>
        <li>
          Una persona del equipo de soporte revisa <strong>solo la evidencia elegida</strong> (nunca tiene acceso a las conversaciones) y
          confirma o descarta la denuncia. No hay bajas automáticas.
        </li>
        <li>
          Cuando una cuenta acumula <strong>3 denuncias confirmadas de personas distintas</strong>, se da de baja: se cierran sus sesiones y se
          le avisa por correo.
        </li>
        <li>
          Quien fue dado de baja puede <strong>apelar</strong> desde la página de apelación con su contraseña. Soporte revisa la apelación; si
          se rechaza, se puede volver a apelar a los 30 días.
        </li>
        <li>
          También podemos dar de baja una cuenta si lo ordena una autoridad competente o si es necesario para proteger a otras personas del
          servicio.
        </li>
      </ul>

      <h2>9. Pausar o dar de baja tu cuenta</h2>
      <p>
        Desde <strong>Ajustes</strong> podés <strong>pausar</strong> tu cuenta (se reactiva al iniciar sesión) o <strong>darla de baja</strong>{' '}
        en forma definitiva. La baja borra o anonimiza tus datos personales, como se explica en la{' '}
        <Link href="/privacidad">Política de Privacidad</Link>, y no se puede deshacer.
      </p>

      <h2>10. Responsabilidad</h2>
      <p>
        No somos responsables por el contenido que publican otras personas, pero actuamos cuando nos lo denuncian. En la medida que lo permita
        la ley, no respondemos por daños indirectos derivados de cortes del servicio o de la pérdida de datos que no dependa de nosotros, por
        ejemplo, si perdés tu código de recuperación. Nada de lo que dicen estos Términos limita los derechos que te da la Ley 24.240 de
        Defensa del Consumidor.
      </p>

      <h2>11. Cambios en estos Términos</h2>
      <p>
        Si cambiamos estos Términos, publicaremos la nueva versión con su fecha y te avisaremos dentro de la app o por correo antes de que se
        aplique. Si un cambio es importante, te pediremos que lo aceptes de nuevo.
      </p>

      <h2>12. Ley aplicable y contacto</h2>
      <p>
        Estos Términos se rigen por las leyes de la República Argentina. Para cualquier conflicto serán competentes {LEGAL.jurisdiction}, sin
        perjuicio del derecho de las personas consumidoras a litigar en su propio domicilio. Consultas:{' '}
        <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>.
      </p>
    </article>
  );
}
