import { sql } from 'drizzle-orm';
import { APPEAL_STATUSES, REPORT_EVIDENCE_SOURCES, REPORT_REASONS, REPORT_STATUSES, type E2eeEnvelope } from '@qemzagram/shared';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  type AnyPgColumn,
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
export const greetingStatusEnum = pgEnum('greeting_status', ['pending', 'accepted', 'declined']);
export const statusAudienceListEnum = pgEnum('status_audience_list', ['except', 'only']);
export const reportReasonEnum = pgEnum('report_reason', REPORT_REASONS);
export const reportStatusEnum = pgEnum('report_status', REPORT_STATUSES);
export const reportEvidenceSourceEnum = pgEnum('report_evidence_source', REPORT_EVIDENCE_SOURCES);
export const appealStatusEnum = pgEnum('appeal_status', APPEAL_STATUSES);

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
  /** Hay algún segundo factor activo (TOTP o llave de acceso). Lo mantiene MfaService. */
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  /** Secreto TOTP activo, CIFRADO (AAD = "totp:<id>"). */
  totpSecretEncrypted: text('totp_secret_encrypted'),
  /** Secreto TOTP en configuración (todavía sin confirmar con un código), CIFRADO. */
  totpPendingEncrypted: text('totp_pending_encrypted'),
  totpEnabledAt: ts('totp_enabled_at'),
  /** Último paso de 30 s usado: el mismo código no sirve dos veces (anti-repetición). */
  totpLastStep: integer('totp_last_step'),
  /** Desafío WebAuthn vigente (CIFRADO, un solo uso, vence a los 5 minutos). */
  webauthnChallengeEncrypted: text('webauthn_challenge_encrypted'),
  webauthnChallengeExpiresAt: ts('webauthn_challenge_expires_at'),
  /**
   * Prueba del consentimiento (Ley 25.326): versión de Términos/Privacidad aceptada al registrarse
   * (`LEGAL_VERSION`) y cuándo. Nulas en cuentas creadas antes de que existieran los textos.
   */
  termsVersion: text('terms_version'),
  termsAcceptedAt: ts('terms_accepted_at'),
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
  (table) => [index('sessions_user_idx').on(table.userId), index('sessions_expires_idx').on(table.expiresAt)],
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
    /** Chat silenciado hasta esta fecha (sin notificaciones de mensajes). Null = con notificaciones. */
    mutedUntil: ts('muted_until'),
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
    /** Registro de una llamada en el chat ("Llamada perdida", "Videollamada · 3:12"). */
    callId: uuid('call_id').references((): AnyPgColumn => calls.id, { onDelete: 'set null' }),
    /** Sobre cifrado de extremo a extremo (Fase 7B). Si existe, `body` va vacío: el servidor no puede leer el contenido. */
    e2ee: jsonb('e2ee').$type<E2eeEnvelope>(),
    /** Compromiso de franqueo (HMAC de quien envía): permite verificar una denuncia sin leer el chat. */
    franking: text('franking'),
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
    /** Cifrado de extremo a extremo: el servidor guarda bytes que no puede leer (ni escanear). */
    e2ee: boolean('e2ee').notNull().default(false),
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
    /** Clave de la llamada envuelta para cada miembro (cifrado de extremo a extremo de LiveKit). */
    e2ee: jsonb('e2ee').$type<E2eeEnvelope>(),
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

/**
 * Suscripciones a notificaciones push (Web Push) de cada dispositivo.
 * La dirección y las claves se guardan CIFRADAS (permiten mandarle avisos a esa persona);
 * para no duplicar se usa el hash SHA-256 de la dirección.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpointHash: text('endpoint_hash').notNull().unique(),
    dataEncrypted: text('data_encrypted').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('push_subscriptions_user_idx').on(table.userId, table.createdAt)],
);

/**
 * Bloqueos: `blockerId` bloqueó a `blockedId`. Se aplica en las DOS direcciones
 * (ninguno puede escribirle, llamarle, ver estados ni encontrar al otro en "personas cercanas").
 */
export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] }), index('user_blocks_blocked_idx').on(table.blockedId)],
);

/**
 * "Personas cercanas" (opt-in). Solo se guarda la CELDA de ~1 km (fila/columna de la grilla),
 * nunca coordenadas. `cellRow/cellCol` en null = invisible (al apagarla se borra la celda).
 * Los contadores limitan los cambios de zona (anti-rastreo) y se conservan al apagar.
 */
export const nearbyPresence = pgTable(
  'nearby_presence',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    cellRow: integer('cell_row'),
    cellCol: integer('cell_col'),
    visibleUntil: ts('visible_until'),
    cellChangedAt: ts('cell_changed_at'),
    changesWindowStart: ts('changes_window_start'),
    changesCount: integer('changes_count').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (table) => [index('nearby_presence_cell_idx').on(table.cellRow, table.cellCol), index('nearby_presence_until_idx').on(table.visibleUntil)],
);

/**
 * Saludos de "Personas cercanas". Al aceptarse, las dos personas se agregan mutuamente a la agenda.
 * Uno por pareja y dirección (si se rechaza, no se puede insistir).
 */
export const nearbyGreetings = pgTable(
  'nearby_greetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: greetingStatusEnum('status').notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
    respondedAt: ts('responded_at'),
  },
  (table) => [
    uniqueIndex('nearby_greetings_pair_idx').on(table.fromId, table.toId),
    index('nearby_greetings_to_idx').on(table.toId, table.status),
    index('nearby_greetings_from_created_idx').on(table.fromId, table.createdAt),
  ],
);

/** Registro de auditoría de seguridad (inicios de sesión, cambios de contraseña, etc.). */
/**
 * Denuncias. La descripción va CIFRADA (AAD = "report:<id>"). Quien denuncia nunca se revela
 * a la persona denunciada. Una sola denuncia PENDIENTE por pareja (quien denuncia → denunciado).
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    targetId: uuid('target_id')
      .notNull()
      .references(() => users.id),
    reason: reportReasonEnum('reason').notNull(),
    descriptionEncrypted: text('description_encrypted').notNull(),
    status: reportStatusEnum('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    /** Nota interna de soporte (cifrada, misma AAD que la descripción). */
    reviewNoteEncrypted: text('review_note_encrypted'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('reports_status_created_idx').on(table.status, table.createdAt),
    index('reports_target_status_idx').on(table.targetId, table.status),
    index('reports_reporter_created_idx').on(table.reporterId, table.createdAt),
    uniqueIndex('reports_one_pending_idx').on(table.reporterId, table.targetId).where(sql`${table.status} = 'pending'`),
  ],
);

/**
 * Evidencia de una denuncia: COPIA de un mensaje o estado elegido por quien denuncia.
 * Se copia (no se referencia) para que soporte nunca tenga acceso al chat original y para que
 * borrar el mensaje o que venza el estado no destruya la prueba. Texto y archivo van cifrados
 * con AAD = "evidence:<id>".
 */
export const reportEvidence = pgTable(
  'report_evidence',
  {
    id: uuid('id').primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    source: reportEvidenceSourceEnum('source').notNull(),
    /** Id del mensaje o estado original (sin clave foránea: el original puede borrarse). */
    sourceId: uuid('source_id').notNull(),
    /** text | sticker | image | file | audio | video (lo determina el servidor). */
    kind: text('kind').notNull(),
    bodyEncrypted: text('body_encrypted').notNull(),
    stickerCode: text('sticker_code'),
    storageKey: text('storage_key').unique(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    /** Mensaje cifrado de extremo a extremo verificado con el franqueo. */
    verified: boolean('verified').notNull().default(false),
    originalCreatedAt: ts('original_created_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('report_evidence_report_idx').on(table.reportId)],
);

/**
 * Apelaciones de cuentas dadas de baja. El mensaje va CIFRADO (AAD = "appeal:<id>").
 * Una sola apelación pendiente por cuenta.
 */
export const appeals = pgTable(
  'appeals',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    messageEncrypted: text('message_encrypted').notNull(),
    status: appealStatusEnum('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    reviewNoteEncrypted: text('review_note_encrypted'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('appeals_status_created_idx').on(table.status, table.createdAt),
    index('appeals_user_idx').on(table.userId),
    uniqueIndex('appeals_one_pending_idx').on(table.userId).where(sql`${table.status} = 'pending'`),
  ],
);

/**
 * Llaves de acceso (WebAuthn). Solo se guarda la clave PÚBLICA: la privada nunca sale del dispositivo.
 * `counter` detecta autenticadores clonados (el contador nunca debe retroceder).
 */
export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports').notNull().default(''),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at'),
  },
  (table) => [index('passkeys_user_idx').on(table.userId)],
);

/** Códigos de respaldo del 2FA: solo su HMAC (con clave del servidor), de un solo uso. */
/**
 * Claves de cifrado de extremo a extremo (Fase 7B). Una ACTIVA por cuenta (`revokedAt` nulo);
 * las anteriores se conservan para verificar mensajes viejos. El servidor guarda la clave PÚBLICA
 * y una copia de la privada CIFRADA con el código de recuperación (que el servidor nunca conoce).
 */
export const e2eeKeys = pgTable(
  'e2ee_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** JWK público (solo kty, crv, x, y). */
    publicKey: jsonb('public_key').$type<{ kty: 'EC'; crv: 'P-256'; x: string; y: string }>().notNull(),
    /** Copia cifrada de la clave privada (null cuando la clave se revoca o la cuenta se da de baja). */
    backup: jsonb('backup').$type<{ v: 1; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string; ct: string }>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
  },
  (table) => [
    index('e2ee_keys_user_idx').on(table.userId),
    uniqueIndex('e2ee_keys_one_active_idx').on(table.userId).where(sql`${table.revokedAt} is null`),
  ],
);

export const mfaBackupCodes = pgTable(
  'mfa_backup_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('mfa_backup_codes_user_hash_idx').on(table.userId, table.codeHash)],
);

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
  (table) => [
    index('audit_log_user_idx').on(table.userId),
    index('audit_log_action_idx').on(table.action),
    // Para la purga por antigüedad (RetentionService) sin recorrer toda la tabla.
    index('audit_log_created_idx').on(table.createdAt),
  ],
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
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type UserBlockRow = typeof userBlocks.$inferSelect;
export type NearbyPresenceRow = typeof nearbyPresence.$inferSelect;
export type NearbyGreetingRow = typeof nearbyGreetings.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type ReportEvidenceRow = typeof reportEvidence.$inferSelect;
export type NewReportEvidenceRow = typeof reportEvidence.$inferInsert;
export type AppealRow = typeof appeals.$inferSelect;
export type MfaBackupCodeRow = typeof mfaBackupCodes.$inferSelect;
export type PasskeyRow = typeof passkeys.$inferSelect;
export type E2eeKeyRow = typeof e2eeKeys.$inferSelect;
