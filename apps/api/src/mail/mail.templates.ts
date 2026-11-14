const RED = '#D91E36';
const DARK = '#1A0F12';

/** Escapa HTML: el nombre del usuario es dato no confiable. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function layout(title: string, bodyHtml: string, action?: { label: string; url: string }): string {
  const button = action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(action.url)}" style="background:${RED};color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:#FFF5F6;font-family:Segoe UI,Arial,sans-serif;color:${DARK}">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(217,30,54,.12)">
<tr><td style="background:${RED};padding:22px 32px;color:#fff;font-size:22px;font-weight:800;letter-spacing:.3px">Qemzagram</td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(title)}</h1>${bodyHtml}${button}
<p style="color:#6b5b5e;font-size:12px;margin-top:32px">Qemzagram by Neoematech · Conectá. Compartí. Disfrutá.<br>Si no fuiste vos, ignorá este correo: nadie puede entrar a tu cuenta sin tu contraseña.</p></td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationEmail(displayName: string, url: string): EmailContent {
  const name = escapeHtml(displayName);
  return {
    subject: 'Verificá tu correo en Qemzagram',
    text: `Hola ${displayName}! Confirmá tu correo para activar tu cuenta (vence en 24 horas): ${url}`,
    html: layout('Confirmá tu correo', `<p>Hola <b>${name}</b>, ¡bienvenido/a a Qemzagram! Confirmá tu correo para activar tu cuenta. El enlace vence en 24 horas.</p>`, {
      label: 'Verificar mi correo',
      url,
    }),
  };
}

export function accountExistsEmail(): EmailContent {
  return {
    subject: 'Ya tenés una cuenta en Qemzagram',
    text: 'Alguien intentó registrarse con este correo, pero ya tiene una cuenta. Si fuiste vos, iniciá sesión o recuperá tu contraseña.',
    html: layout('Ya tenés una cuenta', '<p>Alguien intentó registrarse con este correo, pero ya existe una cuenta asociada. Si fuiste vos, iniciá sesión o usá “Olvidé mi contraseña”.</p>'),
  };
}

export function passwordResetEmail(displayName: string, url: string): EmailContent {
  const name = escapeHtml(displayName);
  return {
    subject: 'Restablecé tu contraseña de Qemzagram',
    text: `Hola ${displayName}. Para elegir una contraseña nueva usá este enlace (vence en 1 hora): ${url}`,
    html: layout('Restablecer contraseña', `<p>Hola <b>${name}</b>. Recibimos un pedido para cambiar tu contraseña. El enlace vence en 1 hora y solo se puede usar una vez.</p>`, {
      label: 'Elegir nueva contraseña',
      url,
    }),
  };
}

export function passwordChangedEmail(displayName: string): EmailContent {
  const name = escapeHtml(displayName);
  return {
    subject: 'Tu contraseña de Qemzagram fue cambiada',
    text: `Hola ${displayName}. Tu contraseña se cambió y cerramos todas tus sesiones. Si no fuiste vos, recuperá tu cuenta de inmediato o escribí a soporte.`,
    html: layout('Contraseña actualizada', `<p>Hola <b>${name}</b>. Tu contraseña se cambió y cerramos todas tus sesiones abiertas. Si no fuiste vos, recuperá tu cuenta de inmediato o contactá a soporte.</p>`),
  };
}

export function accountBannedEmail(displayName: string, appealUrl: string): EmailContent {
  const name = escapeHtml(displayName);
  return {
    subject: 'Tu cuenta de Qemzagram fue dada de baja',
    text: `Hola ${displayName}. Después de revisar varias denuncias, el equipo de soporte dio de baja tu cuenta por incumplir las normas. Si creés que es un error, podés apelar acá: ${appealUrl}`,
    html: layout(
      'Tu cuenta fue dada de baja',
      `<p>Hola <b>${name}</b>. Después de revisar varias denuncias, el equipo de soporte dio de baja tu cuenta por incumplir las normas de la comunidad. Cerramos todas tus sesiones.</p><p>Si creés que es un error, podés pedir una revisión. Vas a necesitar tu tag o correo y tu contraseña.</p>`,
      { label: 'Apelar la decisión', url: appealUrl },
    ),
  };
}

export function appealResultEmail(displayName: string, accepted: boolean, loginUrl: string): EmailContent {
  const name = escapeHtml(displayName);
  return accepted
    ? {
        subject: 'Revisamos tu apelación: tu cuenta está activa',
        text: `Hola ${displayName}. Revisamos tu apelación y reactivamos tu cuenta. Ya podés iniciar sesión: ${loginUrl}`,
        html: layout('Tu cuenta está activa otra vez', `<p>Hola <b>${name}</b>. Revisamos tu apelación y reactivamos tu cuenta. Ya podés volver a iniciar sesión.</p>`, {
          label: 'Iniciar sesión',
          url: loginUrl,
        }),
      }
    : {
        subject: 'Revisamos tu apelación',
        text: `Hola ${displayName}. Revisamos tu apelación y la baja de tu cuenta se mantiene.`,
        html: layout('Revisamos tu apelación', `<p>Hola <b>${name}</b>. Revisamos tu apelación con atención y la baja de tu cuenta se mantiene.</p>`),
      };
}
