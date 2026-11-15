import { Injectable, NotFoundException } from '@nestjs/common';
import type { AttachmentDto, StickerDto } from '@qemzagram/shared';
import { CryptoService } from '../common/crypto.service';
import { AttachmentsRepository } from '../database/repositories/attachments.repository';
import { ConversationsRepository } from '../database/repositories/conversations.repository';
import { ReportsRepository } from '../database/repositories/reports.repository';
import { StickersRepository } from '../database/repositories/stickers.repository';
import type { AttachmentRow, StickerRow } from '../database/schema';
import { BlobStorage } from '../storage/blob-storage.port';
import { MediaUrlService, type MediaScope } from './media-url.service';

export interface ServedFile {
  data: Buffer;
  mimeType: string;
  /** `attachment` fuerza la descarga (documentos); `inline` se muestra (imágenes, audio, video). */
  disposition: 'inline' | 'attachment';
  fileName: string;
}

const NOT_FOUND = { code: 'MEDIA_NOT_FOUND', message: 'Archivo no encontrado' };

/** AAD de los archivos copiados como evidencia de una denuncia. */
export const evidenceAad = (evidenceId: string) => `evidence:${evidenceId}`;

@Injectable()
export class MediaService {
  constructor(
    private readonly attachments: AttachmentsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly stickers: StickersRepository,
    private readonly storage: BlobStorage,
    private readonly crypto: CryptoService,
    private readonly urls: MediaUrlService,
    private readonly reports: ReportsRepository,
  ) {}

  /** DTO de un adjunto con su URL firmada. El nombre original se descifra (va cifrado en la base). */
  toAttachmentDto(row: AttachmentRow): AttachmentDto {
    const signed = this.urls.sign('a', row.id);
    return {
      id: row.id,
      kind: row.kind,
      mimeType: row.mimeType,
      size: row.sizeBytes,
      name: row.nameEncrypted ? this.decryptName(row) : null,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      url: signed.url,
      expiresAt: signed.expiresAt,
      e2ee: row.e2ee,
    };
  }

  encryptName(name: string, attachmentId: string): string {
    return this.crypto.encryptText(name, `attachment-name:${attachmentId}`);
  }

  /**
   * Devuelve un adjunto SOLO si: la firma es válida y no venció, el adjunto existe
   * y quien lo pide es miembro ACTUAL de la conversación. Cualquier fallo → "no encontrado".
   */
  async getAttachmentForViewer(viewerId: string, id: string, exp: number, sig: string): Promise<ServedFile> {
    if (!this.urls.verify('a', id, exp, sig)) throw new NotFoundException(NOT_FOUND);
    const row = await this.attachments.findById(id);
    if (!row || !(await this.conversations.getMemberRole(row.conversationId, viewerId))) throw new NotFoundException(NOT_FOUND);
    const data = await this.readBlob(row.storageKey, row.id);
    // Cifrado de extremo a extremo: se entregan los bytes cifrados (los descifra el navegador) y nunca se muestran.
    if (row.e2ee) return { data, mimeType: 'application/octet-stream', disposition: 'attachment', fileName: `qemzagram-${row.id.slice(0, 8)}.bin` };
    const isDocument = row.kind === 'file';
    return {
      data,
      mimeType: row.mimeType,
      disposition: isDocument ? 'attachment' : 'inline',
      fileName: (isDocument && row.nameEncrypted ? this.decryptName(row) : null) ?? `qemzagram-${row.id.slice(0, 8)}`,
    };
  }

  /** Sticker propio: SOLO su dueño lo puede ver (en los chats viaja como copia, en un adjunto). */
  async getStickerForOwner(viewerId: string, id: string, exp: number, sig: string): Promise<ServedFile> {
    if (!this.urls.verify('s', id, exp, sig)) throw new NotFoundException(NOT_FOUND);
    const row = await this.stickers.findOwned(id, viewerId);
    if (!row) throw new NotFoundException(NOT_FOUND);
    return { data: await this.readBlob(row.storageKey, row.id), mimeType: 'image/webp', disposition: 'inline', fileName: 'sticker.webp' };
  }

  /**
   * Archivo de evidencia de una denuncia: SOLO para el rol de soporte (el rol se lee de la base
   * en cada petición). Para cualquier otra persona, "no encontrado".
   */
  async getEvidenceForSupport(viewer: { role: 'user' | 'support'; mfaEnabled: boolean }, id: string, exp: number, sig: string): Promise<ServedFile> {
    if (viewer.role !== 'support' || !viewer.mfaEnabled || !this.urls.verify('r', id, exp, sig)) throw new NotFoundException(NOT_FOUND);
    const row = await this.reports.findEvidence(id);
    if (!row?.storageKey || !row.mimeType) throw new NotFoundException(NOT_FOUND);
    const isDocument = row.kind === 'file';
    return {
      data: await this.readBlob(row.storageKey, evidenceAad(row.id)),
      mimeType: row.mimeType,
      disposition: isDocument ? 'attachment' : 'inline',
      fileName: `evidencia-${row.id.slice(0, 8)}`,
    };
  }

  toStickerDto(row: StickerRow): StickerDto {
    return { id: row.id, url: this.urls.sign('s', row.id).url, createdAt: row.createdAt.toISOString() };
  }

  verifySignature(scope: MediaScope, id: string, exp: number, sig: string): boolean {
    return this.urls.verify(scope, id, exp, sig);
  }

  /** Lee y descifra un archivo del almacenamiento (AAD = id del adjunto o sticker). */
  async readBlob(storageKey: string, aad: string): Promise<Buffer> {
    const encrypted = await this.storage.get(storageKey);
    if (!encrypted) throw new NotFoundException(NOT_FOUND);
    try {
      return this.crypto.decryptBlob(encrypted, aad);
    } catch {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  private decryptName(row: AttachmentRow): string | null {
    if (!row.nameEncrypted) return null;
    try {
      return this.crypto.decryptText(row.nameEncrypted, `attachment-name:${row.id}`);
    } catch {
      return null;
    }
  }
}
