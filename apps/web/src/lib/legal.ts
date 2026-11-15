/**
 * Datos de quien presta el servicio, usados por /terminos, /privacidad y el menú de ayuda.
 * Es el ÚNICO lugar a completar antes de publicar (ver docs/LEGAL.md). Los textos legales son BORRADORES:
 * hacelos revisar por un/a abogado/a antes de abrir Qemzagram al público.
 */
export const LEGAL = {
  /** Nombre y apellido (persona humana) o razón social (sociedad) responsable de los datos. */
  responsible: '[COMPLETAR: nombre y apellido o razón social]',
  /** CUIT o CUIL del responsable. */
  taxId: '[COMPLETAR: CUIT/CUIL]',
  /** Domicilio legal (lo pide la Ley 25.326 para ejercer derechos por escrito). */
  address: '[COMPLETAR: domicilio legal]',
  /** Jurisdicción para conflictos (en relaciones de consumo prevalece el domicilio de la persona usuaria). */
  jurisdiction: '[COMPLETAR: por ejemplo, tribunales ordinarios de San Miguel de Tucumán]',
  /** Número de inscripción de la base de datos ante la AAIP, cuando lo tengas. */
  aaipRegistration: '[COMPLETAR: número de inscripción ante la AAIP]',
  /** Proveedor de correo electrónico (SMTP) contratado. */
  mailProvider: '[COMPLETAR: proveedor de correo]',
  supportEmail: 'soporte@qemzagram.com',
  privacyEmail: 'privacidad@qemzagram.com',
} as const;
