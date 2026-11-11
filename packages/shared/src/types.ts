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

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
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
