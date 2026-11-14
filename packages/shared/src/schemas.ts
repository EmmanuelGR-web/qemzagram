import { z } from 'zod';
import { isValidNearbyCell } from './nearby';
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  GENERAL_STICKER_CODES,
  GROUP_MAX_MEMBERS,
  GROUP_TITLE_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  CALL_KINDS,
  CONTACTS_MAX,
  STATUS_AUDIENCES,
  STATUS_BACKGROUNDS,
  STATUS_MEDIA_KINDS,
  STATUS_TEXT_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  RESERVED_TAGS,
  TAG_MAX_LENGTH,
  TAG_MIN_LENGTH,
  TAG_REGEX,
  UPLOAD_KINDS,
} from './constants';
import { getPasswordIssues, PASSWORD_ISSUE_MESSAGES } from './password';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Correo demasiado largo')
  .email('Correo electrónico inválido');

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(TAG_MIN_LENGTH, `El tag debe tener al menos ${TAG_MIN_LENGTH} caracteres`)
  .max(TAG_MAX_LENGTH, `El tag admite hasta ${TAG_MAX_LENGTH} caracteres`)
  .regex(TAG_REGEX, 'Solo letras minúsculas, números, punto y guion bajo (sin empezar ni terminar con símbolo)')
  .refine((value) => !/[._]{2}/.test(value), 'No uses dos símbolos seguidos')
  .refine((value) => !RESERVED_TAGS.includes(value), 'Ese tag está reservado');

/** Tag usado para buscar: acepta un "@" inicial opcional. */
export const tagLookupSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().min(TAG_MIN_LENGTH).max(TAG_MAX_LENGTH).regex(/^[a-z0-9._]+$/));

export const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, 'Contraseña demasiado larga')
  .superRefine((value, ctx) => {
    for (const issue of getPasswordIssues(value)) {
      if (issue === 'personal') continue; // requiere contexto; se valida en el esquema que lo conoce
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PASSWORD_ISSUE_MESSAGES[issue] });
    }
  });

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Ingresá un nombre')
  .max(DISPLAY_NAME_MAX_LENGTH, `Máximo ${DISPLAY_NAME_MAX_LENGTH} caracteres`)
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), 'Caracteres no permitidos');

export const registerSchema = z
  .object({
    email: emailSchema,
    tag: tagSchema,
    displayName: displayNameSchema.optional(),
    password: passwordSchema,
  })
  .superRefine((value, ctx) => {
    if (getPasswordIssues(value.password, { tag: value.tag, email: value.email }).includes('personal')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: PASSWORD_ISSUE_MESSAGES.personal });
    }
  });

export const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const tokenSchema = z.object({ token: z.string().trim().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: passwordSchema,
});

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: z.string().trim().max(BIO_MAX_LENGTH, `Máximo ${BIO_MAX_LENGTH} caracteres`).optional(),
    isPrivate: z.boolean().optional(),
  })
  .strict();

export const confirmPasswordSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });

export const addContactSchema = z.object({
  tag: tagLookupSchema,
  alias: z.string().trim().max(DISPLAY_NAME_MAX_LENGTH).optional(),
});

export const createDirectChatSchema = z.object({ tag: tagLookupSchema });

export const createGroupSchema = z.object({
  title: z.string().trim().min(1, 'Ingresá un nombre para el grupo').max(GROUP_TITLE_MAX_LENGTH),
  memberTags: z
    .array(tagLookupSchema)
    .min(1, 'Elegí al menos un miembro')
    .max(GROUP_MAX_MEMBERS - 1, `Un grupo admite hasta ${GROUP_MAX_MEMBERS} miembros`),
});

export const addGroupMemberSchema = z.object({ tag: tagLookupSchema });

export const sendMessageSchema = z.object({
  body: z
    .string()
    .min(1)
    .max(MESSAGE_MAX_LENGTH)
    .refine((value) => value.trim().length > 0, 'El mensaje está vacío'),
});

export const listMessagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Campos de texto que acompañan a un archivo subido al chat (multipart). */
export const sendAttachmentSchema = z
  .object({
    kind: z.enum(UPLOAD_KINDS, { message: 'Tipo de adjunto inválido' }),
    caption: z.string().max(MESSAGE_MAX_LENGTH).optional().default(''),
  })
  .strict();

/** Enviar un sticker: del pack general (por código) o uno propio (por id). */
export const sendStickerSchema = z.union([
  z.object({ code: z.enum(GENERAL_STICKER_CODES, { message: 'Sticker desconocido' }) }).strict(),
  z.object({ stickerId: z.string().uuid() }).strict(),
]);

/** Estado de texto: texto obligatorio + fondo de una lista cerrada. */
export const createTextStatusSchema = z
  .object({
    body: z
      .string()
      .max(STATUS_TEXT_MAX_LENGTH, `Máximo ${STATUS_TEXT_MAX_LENGTH} caracteres`)
      .refine((value) => value.trim().length > 0, 'Escribí algo para tu estado'),
    background: z.enum(STATUS_BACKGROUNDS, { message: 'Fondo inválido' }),
  })
  .strict();

/** Campos de texto que acompañan a la foto o video de un estado (multipart). */
export const createMediaStatusSchema = z
  .object({
    kind: z.enum(STATUS_MEDIA_KINDS, { message: 'Tipo de estado inválido' }),
    caption: z.string().max(STATUS_TEXT_MAX_LENGTH, `Máximo ${STATUS_TEXT_MAX_LENGTH} caracteres`).optional().default(''),
  })
  .strict();

/** Privacidad de los estados: opción + las dos listas (por tag, solo personas de tu agenda). */
export const updateStatusPrivacySchema = z
  .object({
    audience: z.enum(STATUS_AUDIENCES, { message: 'Opción de privacidad inválida' }),
    except: z.array(tagLookupSchema).max(CONTACTS_MAX),
    only: z.array(tagLookupSchema).max(CONTACTS_MAX),
  })
  .strict();

/** Iniciar una llamada desde un chat: solo se elige si es de voz o de video. */
export const startCallSchema = z.object({ kind: z.enum(CALL_KINDS, { message: 'Tipo de llamada inválido' }) }).strict();

/** Suscripción Web Push que entrega el navegador (`PushSubscription.toJSON()`). */
export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(1000).startsWith('https://', 'La dirección tiene que ser https'),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, 'Clave inválida'),
        auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/, 'Clave inválida'),
      })
      .strict(),
  })
  .strict();

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) }).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendAttachmentInput = z.infer<typeof sendAttachmentSchema>;
export type SendStickerInput = z.infer<typeof sendStickerSchema>;
export type CreateTextStatusInput = z.infer<typeof createTextStatusSchema>;
export type CreateMediaStatusInput = z.infer<typeof createMediaStatusSchema>;
export type UpdateStatusPrivacyInput = z.infer<typeof updateStatusPrivacySchema>;
export type StartCallInput = z.infer<typeof startCallSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/* ---------- Fase 5: bloqueos ---------- */

/** Se bloquea por id (en "personas cercanas" el tag no se ve hasta aceptar un saludo). */
export const blockUserSchema = z.object({ userId: z.string().uuid() }).strict();

/* ---------- Fase 5: personas cercanas ---------- */

/** Solo se acepta una CELDA de la grilla (~1 km), nunca coordenadas. */
export const nearbyCellSchema = z
  .object({ row: z.number().int(), col: z.number().int() })
  .strict()
  .refine(isValidNearbyCell, 'Ubicación inválida');

/** Activar (o renovar) la visibilidad: exige el consentimiento explícito en cada pedido. */
export const nearbyPresenceSchema = z.object({ cell: nearbyCellSchema, consent: z.literal(true) }).strict();

/** Saludar a alguien cercano (solo se acepta a quien aparece en tu lista de cercanos). */
export const nearbyGreetSchema = z.object({ userId: z.string().uuid() }).strict();
