import type { ATTACHMENT_KINDS, GeneralStickerCode, UPLOAD_KINDS } from './constants';

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

export interface SelfUser extends PublicUser {
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface ContactDto {
  user: PublicUser;
  alias: string | null;
  addedAt: string;
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

export interface ConversationDto {
  id: string;
  type: ConversationType;
  title: string | null;
  members: ConversationMemberDto[];
  lastMessage: MessageDto | null;
  createdAt: string;
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
}
