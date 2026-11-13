import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userStatusEnum = pgEnum('user_status', ['active', 'paused', 'banned', 'deleted']);
export const userRoleEnum = pgEnum('user_role', ['user', 'support']);
export const conversationTypeEnum = pgEnum('conversation_type', ['direct', 'group']);
export const memberRoleEnum = pgEnum('member_role', ['admin', 'member']);
export const emailTokenTypeEnum = pgEnum('email_token_type', ['verify', 'reset']);
export const attachmentKindEnum = pgEnum('attachment_kind', ['image', 'file', 'audio', 'video', 'sticker']);
export const statusKindEnum = pgEnum('status_kind', ['text', 'image', 'video']);
export const statusAudienceEnum = pgEnum('status_audience', ['contacts', 'except', 'only']);
export const callKindEnum = pgEnum('call_kind', ['audio', 'video']);
export const callStatusEnum = pgEnum('call_status', ['ringing', 'active', 'ended']);
export const callEndReasonEnum = pgEnum('call_end_reason', ['completed', 'missed', 'declined', 'cancelled', 'failed']);
export const callParticipantStateEnum = pgEnum('call_participant_state', ['invited', 'joined', 'left', 'declined']);
export const statusAudienceListEnum = pgEnum('status_audience_list', ['except', 'only']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  tag: text('tag').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url'),
  coverUrl: text('cover_url'),
  isPrivate: boolean('is_private').notNull().default(false),
  /** Quién puede ver mis estados (ver `status_audience_members`). */
  statusAudience: statusAudienceEnum('status_audience').notNull().default('contacts'),
  role: userRoleEnum('role').notNull().default('user'),
  status: userStatusEnum('status').notNull().default('active'),
  emailVerifiedAt: ts('email_verified_at'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Tokens de un solo uso (verificación de correo / restablecer contraseña). Solo se guarda su hash. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: emailTokenTypeEnum('type').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('email_tokens_user_idx').on(table.userId)],
);

/** Sesiones con refresh token rotativo. Solo se guarda el hash del token. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

/** Agenda: a quién agregó cada usuario (por tag). */
export const contacts = pgTable(
  'contacts',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    alias: text('alias'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.contactId] })],
);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: conversationTypeEnum('type').notNull(),
  title: text('title'),
  /** Para chats 1 a 1: ids ordenados "a:b". Evita duplicar la conversación. */
  directKey: text('direct_key').unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_members_user_idx').on(table.userId),
  ],
);

/** El cuerpo del mensaje se guarda cifrado (AES-256-GCM). Ver CryptoService. */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    /** Código de un sticker del pack general (validado contra una lista cerrada). */
    stickerCode: text('sticker_code'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('messages_conversation_created_idx').on(table.conversationId, table.createdAt)],
);

/**
 * Adjunto de un mensaje (imagen, documento, nota de voz, video o sticker propio enviado).
 * El archivo vive cifrado en el almacenamiento (`storageKey`); el nombre original se guarda cifrado.
 * `conversationId` se repite para autorizar la descarga sin pasar por el mensaje.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id),
    kind: attachmentKindEnum('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    /** Tipo MIME determinado por el SERVIDOR (nunca el que manda el cliente). */
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    nameEncrypted: text('name_encrypted'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('attachments_conversation_idx').on(table.conversationId)],
);

/** Stickers propios ("Mis stickers"): WebP 512×512 cifrado, visible solo para su dueño. */
export const stickers = pgTable(
  'stickers',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('stickers_owner_idx').on(table.ownerId)],
);

/**
 * Estados de 24 horas. El texto/epígrafe va CIFRADO (AAD = "status:<id>") y el archivo (foto o video)
 * vive cifrado en el almacenamiento. Nunca se muestran después de `expiresAt`, aunque la limpieza
 * periódica todavía no los haya borrado.
 */
export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: statusKindEnum('kind').notNull(),
    bodyEncrypted: text('body_encrypted').notNull(),
    /** Fondo de los estados de texto (código de una lista cerrada). */
    background: text('background'),
    storageKey: text('storage_key').unique(),
    /** Tipo MIME determinado por el SERVIDOR. */
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (table) => [index('statuses_owner_expires_idx').on(table.ownerId, table.expiresAt), index('statuses_expires_idx').on(table.expiresAt)],
);

/** Quién vio cada estado (solo lo consulta su dueño). Se borra junto con el estado. */
export const statusViews = pgTable(
  'status_views',
  {
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'cascade' }),
    viewerId: uuid('viewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: ts('viewed_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.statusId, table.viewerId] }), index('status_views_viewer_idx').on(table.viewerId)],
);

/**
 * Listas de privacidad de los estados: "excepto" y "solo con". Se guardan las dos por separado
 * para que cambiar de opción no pierda la otra lista.
 */
export const statusAudienceMembers = pgTable(
  'status_audience_members',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    list: statusAudienceListEnum('list').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.list, table.memberId] })],
);

/**
 * Llamadas y videollamadas. Los medios (audio/video) NUNCA pasan por la API ni se guardan:
 * viajan por el servidor de llamadas (LiveKit). Acá solo queda el registro (quién, cuándo, cuánto).
 * Una conversación tiene como máximo UNA llamada en curso (índice único parcial).
 */
export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    startedBy: uuid('started_by')
      .notNull()
      .references(() => users.id),
    kind: callKindEnum('kind').notNull(),
    status: callStatusEnum('status').notNull().default('ringing'),
    createdAt: ts('created_at').notNull().defaultNow(),
    answeredAt: ts('answered_at'),
    endedAt: ts('ended_at'),
    endReason: callEndReasonEnum('end_reason'),
  },
  (table) => [
    index('calls_conversation_idx').on(table.conversationId, table.createdAt),
    uniqueIndex('calls_one_open_per_conversation').on(table.conversationId).where(sql`${table.status} <> 'ended'`),
    index('calls_open_idx').on(table.status).where(sql`${table.status} <> 'ended'`),
  ],
);

export const callParticipants = pgTable(
  'call_participants',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    state: callParticipantStateEnum('state').notNull().default('invited'),
    joinedAt: ts('joined_at'),
    leftAt: ts('left_at'),
  },
  (table) => [primaryKey({ columns: [table.callId, table.userId] }), index('call_participants_user_idx').on(table.userId)],
);

/** Registro de auditoría de seguridad (inicios de sesión, cambios de contraseña, etc.). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    ip: text('ip'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('audit_log_user_idx').on(table.userId), index('audit_log_action_idx').on(table.action)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type EmailTokenRow = typeof emailTokens.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type NewAttachmentRow = typeof attachments.$inferInsert;
export type StickerRow = typeof stickers.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;
export type NewStatusRow = typeof statuses.$inferInsert;
export type CallRow = typeof calls.$inferSelect;
export type CallParticipantRow = typeof callParticipants.$inferSelect;
