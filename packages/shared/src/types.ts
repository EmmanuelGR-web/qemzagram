import type { ATTACHMENT_KINDS, CALL_END_REASONS, CHAT_MUTE_DURATIONS, REPORT_EVIDENCE_SOURCES, REPORT_STATUSES, ReportReason, APPEAL_STATUSES, MFA_METHODS, CALL_KINDS, CALL_PARTICIPANT_STATES, CALL_STATUSES, GeneralStickerCode, STATUS_KINDS, STATUS_MEDIA_KINDS, StatusAudience, StatusBackground, UPLOAD_KINDS } from './constants';
import type { NearbyDistance, NearbyGreetingState } from './nearby';

/** Contratos de datos (DTO) que viajan entre la API y la Web. */

export interface PublicUser {
  id: string;
  tag: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  isPrivate: boolean;
}

export type UserRole = 'user' | 'support';

export interface SelfUser extends PublicUser {
  email: string;
  emailVerified: boolean;
  createdAt: string;
  /** "support" habilita el panel de soporte (que NUNCA da acceso a conversaciones). */
  role: UserRole;
  /** Tiene activado un segundo factor (app autenticadora o llave de acceso). */
  mfaEnabled: boolean;
}

export interface ContactDto {
  user: PublicUser;
  alias: string | null;
  addedAt: string;
  /** Si VOS bloqueaste a esta persona (nunca se informa si ella te bloqueó). */
  blocked: boolean;
}

/** Persona que bloqueaste (pantalla Ajustes → Bloqueados). */
export interface BlockedUserDto {
  user: PublicUser;
  blockedAt: string;
}

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/**
 * Adjunto de un mensaje. `url` es una URL FIRMADA y con vencimiento (relativa a la API);
 * además, la API exige sesión y ser miembro de la conversación para servir el archivo.
 */
export interface AttachmentDto {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  /** Nombre original (solo para documentos). */
  name: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
  expiresAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  /** Texto del mensaje o epígrafe del adjunto (puede estar vacío si hay adjunto o sticker). */
  body: string;
  attachment: AttachmentDto | null;
  /** Sticker del pack general (los stickers propios llegan como `attachment` de tipo "sticker"). */
  sticker: GeneralStickerCode | null;
  /** Registro de una llamada terminada (el mensaje lo "envía" quien llamó). */
  call: CallSummaryDto | null;
  createdAt: string;
}

/** Sticker propio de "Mis stickers". */
export interface StickerDto {
  id: string;
  url: string;
  createdAt: string;
}

export type ConversationType = 'direct' | 'group';
export type MemberRole = 'admin' | 'member';

export interface ConversationMemberDto {
  user: PublicUser;
  role: MemberRole;
}

export type ChatMuteDuration = (typeof CHAT_MUTE_DURATIONS)[number];

export interface ConversationDto {
  id: string;
  type: ConversationType;
  title: string | null;
  members: ConversationMemberDto[];
  lastMessage: MessageDto | null;
  createdAt: string;
  /** Chat 1 a 1 con alguien que VOS bloqueaste: no se puede escribir ni llamar hasta desbloquear. */
  blockedByMe: boolean;
  /** Hasta cuándo VOS silenciaste este chat (null = con notificaciones). Lo ve solo quien silenció. */
  mutedUntil: string | null;
}

export type StatusKind = (typeof STATUS_KINDS)[number];
export type StatusMediaKind = (typeof STATUS_MEDIA_KINDS)[number];

/** Archivo de un estado (foto o video). `url` es FIRMADA; además la API vuelve a verificar el permiso. */
export interface StatusMediaDto {
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Un estado que dura 24 horas. */
export interface StatusDto {
  id: string;
  ownerId: string;
  kind: StatusKind;
  /** Texto del estado o epígrafe de la foto/video. */
  body: string;
  /** Fondo (solo estados de texto). */
  background: StatusBackground | null;
  media: StatusMediaDto | null;
  createdAt: string;
  expiresAt: string;
  /** ¿Ya lo viste? (los propios cuentan como vistos). */
  viewed: boolean;
  /** Cuántas personas lo vieron: SOLO en tus propios estados (`null` en los ajenos). */
  viewCount: number | null;
}

/** Una persona que vio tu estado (solo lo consulta el dueño). */
export interface StatusViewDto {
  user: PublicUser;
  viewedAt: string;
}

/** Estados vigentes de una persona de tu agenda, del más viejo al más nuevo. */
export interface StatusFeedItemDto {
  user: PublicUser;
  statuses: StatusDto[];
  /** true si ya viste todos sus estados vigentes. */
  allViewed: boolean;
}

export interface StatusOverviewDto {
  /** Tus estados vigentes. */
  mine: StatusDto[];
  /** Estados de tu agenda que podés ver, empezando por los más recientes. */
  feed: StatusFeedItemDto[];
}

/**
 * Quién puede ver mis estados. Las dos listas se guardan por separado: cambiar de opción no borra la otra.
 * Siempre se limita a personas de tu agenda que también te agregaron.
 */
export interface StatusPrivacyDto {
  audience: StatusAudience;
  /** "Mi agenda excepto…" */
  except: PublicUser[];
  /** "Solo compartir con…" */
  only: PublicUser[];
}

/** Resumen de una llamada terminada, para mostrar en el chat. */
export interface CallSummaryDto {
  id: string;
  kind: CallKind;
  endReason: CallEndReason | null;
  /** Duración desde que alguien atendió (null si nadie atendió). */
  durationMs: number | null;
}

export type CallKind = (typeof CALL_KINDS)[number];
export type CallStatus = (typeof CALL_STATUSES)[number];
export type CallEndReason = (typeof CALL_END_REASONS)[number];
export type CallParticipantState = (typeof CALL_PARTICIPANT_STATES)[number];

export interface CallParticipantDto {
  user: PublicUser;
  state: CallParticipantState;
}

/** Una llamada (1 a 1 o de grupo). Solo la ven los miembros de la conversación. */
export interface CallDto {
  id: string;
  conversationId: string;
  conversationType: ConversationType;
  /** Nombre del grupo (null en los chats 1 a 1). */
  title: string | null;
  kind: CallKind;
  status: CallStatus;
  startedBy: string;
  participants: CallParticipantDto[];
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: CallEndReason | null;
}

/** Para entrar a la sala de medios: token de vida corta y dirección del servidor de llamadas. */
export interface CallJoinDto {
  call: CallDto;
  token: string;
  url: string;
}

/**
 * Contenido de una notificación push. Es MÍNIMO a propósito: nunca lleva texto de mensajes;
 * viaja cifrado de punta a punta entre la API y el navegador (protocolo Web Push).
 */
export type PushPayload =
  | { type: 'call'; callId: string; conversationId: string; kind: CallKind; title: string; group: boolean }
  /** La llamada dejó de sonar (la atendieron, la rechazaron o terminó): cerrar la notificación. */
  | { type: 'call-closed'; callId: string; conversationId: string; kind: CallKind; title: string; missed: boolean }
  /** Mensaje nuevo. NUNCA lleva el contenido: solo quién (o qué grupo) y a qué chat abrir. */
  | { type: 'message'; conversationId: string; title: string; group: boolean };

export interface PushConfigDto {
  /** Clave pública VAPID (null = notificaciones deshabilitadas en el servidor). */
  publicKey: string | null;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  code?: string;
  issues?: { path: string; message: string }[];
}

/** Eventos de tiempo real (Socket.IO) del servidor hacia el cliente. */
export interface ServerToClientEvents {
  'chat:message': (message: MessageDto) => void;
  'chat:created': (conversation: ConversationDto) => void;
  'chat:updated': (conversation: ConversationDto) => void;
  /** Alguien de tu agenda publicó o borró un estado (o cambió quién los ve): volvé a pedir la lista. */
  'status:changed': (payload: { ownerId: string }) => void;
  /** Te están llamando. */
  'call:incoming': (call: CallDto) => void;
  /** Cambió el estado de una llamada en la que participás (alguien atendió, cortó, terminó…). */
  'call:updated': (call: CallDto) => void;
  /** Alguien cercano te saludó. */
  'nearby:greeting': (greeting: NearbyGreetingDto) => void;
  /** Aceptaron tu saludo (o se saludaron mutuamente): ya está en tu agenda. */
  'nearby:connected': (contact: ContactDto) => void;
}

/* ---------- Fase 5: personas cercanas ---------- */

/** Mi visibilidad en "Personas cercanas". Nunca incluye la ubicación. */
export interface NearbyStatusDto {
  visible: boolean;
  /** Hasta cuándo sigo visible (se apaga sola). */
  visibleUntil: string | null;
  /** Cambios de zona que me quedan hoy (límite anti-rastreo). */
  changesLeft: number;
}

/** Lo único que se ve de alguien cercano: sin tag, sin bio, sin portada (hasta conectar). */
export interface NearbyUserDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface NearbyPersonDto {
  user: NearbyUserDto;
  /** Rango de distancia; nunca el número exacto. */
  distance: NearbyDistance;
  greeting: NearbyGreetingState;
  /** Id del saludo RECIBIDO (para aceptarlo o rechazarlo desde la lista); si no, null. */
  greetingId: string | null;
  /** El tag solo se ve cuando ya están conectados (agenda mutua). */
  tag: string | null;
}

/** Un saludo pendiente (recibido o enviado). Nunca dice si fue rechazado. */
export interface NearbyGreetingDto {
  id: string;
  user: NearbyUserDto;
  createdAt: string;
}

/** Resultado de saludar: queda enviado, o se conectaron (la otra persona ya te había saludado). */
export interface NearbyGreetResultDto {
  state: 'sent' | 'connected';
  contact: ContactDto | null;
}

export interface NearbyGreetingsDto {
  received: NearbyGreetingDto[];
  sent: NearbyGreetingDto[];
}

/* ---------- Fase 6: denuncias ---------- */

export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportEvidenceSource = (typeof REPORT_EVIDENCE_SOURCES)[number];

/**
 * Una denuncia vista por QUIEN LA HIZO. No se informa la decisión exacta (confirmada o descartada):
 * solo si ya fue revisada, para no convertir las denuncias en una herramienta de presión.
 */
export interface MyReportDto {
  id: string;
  user: { id: string; displayName: string; avatarUrl: string | null };
  reason: ReportReason;
  reviewed: boolean;
  evidenceCount: number;
  createdAt: string;
}

/* ---------- Fase 6: panel de soporte ---------- */

export type AppealStatus = (typeof APPEAL_STATUSES)[number];
export type AccountStatus = 'active' | 'paused' | 'banned' | 'deleted';

/** Lo mínimo que soporte necesita para identificar una cuenta. Nunca el correo completo. */
export interface SupportUserRef {
  id: string;
  tag: string;
  displayName: string;
  status: AccountStatus;
}

export interface SupportReportDto {
  id: string;
  reason: ReportReason;
  status: ReportStatus;
  description: string;
  evidenceCount: number;
  reporter: SupportUserRef;
  target: SupportUserRef & { confirmedReports: number };
  createdAt: string;
  reviewedAt: string | null;
}

/**
 * Evidencia tal como la ve soporte: la COPIA que eligió quien denunció.
 * `media.url` es firmada y además exige rol de soporte en cada descarga.
 */
export interface SupportEvidenceDto {
  id: string;
  source: ReportEvidenceSource;
  kind: string;
  body: string;
  sticker: GeneralStickerCode | null;
  media: { url: string; mimeType: string; width: number | null; height: number | null; durationMs: number | null } | null;
  originalCreatedAt: string;
}

export interface SupportReportDetailDto extends SupportReportDto {
  evidence: SupportEvidenceDto[];
}

export interface ResolveReportResultDto {
  report: SupportReportDto;
  /** La confirmación alcanzó el umbral y la cuenta quedó dada de baja. */
  targetBanned: boolean;
}

export interface SupportAppealDto {
  id: string;
  user: SupportUserRef;
  message: string;
  status: AppealStatus;
  confirmedReports: number;
  createdAt: string;
  reviewedAt: string | null;
}

/** Ficha de una cuenta para soporte: estado y denuncias, nunca mensajes ni contactos. */
export interface SupportUserDto extends SupportUserRef {
  role: UserRole;
  /** Correo enmascarado (j***@gmail.com) para verificar identidad sin exponerlo. */
  emailMasked: string;
  emailVerified: boolean;
  createdAt: string;
  reports: { pending: number; confirmed: number };
}

/** Estadísticas AGREGADAS (solo conteos): ningún dato de una persona en particular. */
export interface SupportStatsDto {
  users: { total: number; active: number; paused: number; banned: number; deleted: number; newLast7d: number; newLast30d: number };
  activity: {
    messagesLast24h: number;
    messagesLast7d: number;
    directChats: number;
    groups: number;
    activeStatuses: number;
    callsLast7d: number;
    nearbyVisibleNow: number;
  };
  moderation: { reportsPending: number; reportsConfirmed: number; reportsDismissed: number; appealsPending: number; bansLast30d: number };
  generatedAt: string;
}

/* ---------- Fase 7A: 2FA ---------- */

export type MfaMethod = (typeof MFA_METHODS)[number];

/** Respuesta del login: la sesión, o el aviso de que falta el segundo paso (sin sesión todavía). */
export type LoginResultDto = { mfaRequired: false; user: SelfUser } | { mfaRequired: true; methods: MfaMethod[] };

export interface MfaStatusDto {
  enabled: boolean;
  totp: boolean;
  backupCodesLeft: number;
  passkeys: PasskeyDto[];
}

/** Una llave de acceso registrada (huella, cara, PIN del celular o llave física). Nunca incluye la clave. */
export interface PasskeyDto {
  id: string;
  name: string;
  /** Sincronizada en la nube del fabricante (por ejemplo, llavero de iCloud o Google). */
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeyRegisteredDto {
  passkey: PasskeyDto;
  /** Si era el primer segundo factor, códigos de respaldo nuevos (se muestran una sola vez). */
  backupCodes: string[] | null;
}

/** Datos para cargar en la app autenticadora. Se muestran UNA vez, al configurar. */
export interface TotpSetupDto {
  secret: string;
  otpauthUrl: string;
}

/** Códigos de respaldo en claro: se muestran UNA sola vez (en la base solo queda su hash). */
export interface BackupCodesDto {
  codes: string[];
}
