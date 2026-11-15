import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { parseE2eeContent, REPORTS_PER_DAY, verifyFranking, type CreateReportInput, type E2eeContent, type MyReportDto } from '@qemzagram/shared';
import { randomUUID } from 'node:crypto';
import { USER_NOT_FOUND } from '../blocks/blocks.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AttachmentsRepository } from '../database/repositories/attachments.repository';
import { ConversationsRepository } from '../database/repositories/conversations.repository';
import { ReportsRepository } from '../database/repositories/reports.repository';
import { StatusesRepository } from '../database/repositories/statuses.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { MessageRow, NewReportEvidenceRow } from '../database/schema';
import { evidenceAad, MediaService } from '../media/media.service';
import { statusAad } from '../statuses/statuses.service';
import { BlobStorage } from '../storage/blob-storage.port';

export const reportAad = (reportId: string) => `report:${reportId}`;

const INVALID_EVIDENCE = {
  code: 'INVALID_EVIDENCE',
  message: 'Alguno de los mensajes o estados elegidos no es de esta persona o ya no está disponible',
};
const DAY_MS = 24 * 60 * 60 * 1000;

type Reveal = NonNullable<CreateReportInput['evidence'][number]['reveal']>;

/** Una evidencia lista para guardar y, si tiene archivo, la clave del archivo ya copiado. */
interface CollectedEvidence {
  row: NewReportEvidenceRow;
  storageKey: string | null;
}

/**
 * Denuncias. La evidencia la elige quien denuncia y se COPIA cifrada a la denuncia:
 * soporte ve solo esa copia, nunca la conversación (regla de seguridad 10).
 * Solo se acepta como evidencia algo que quien denuncia PUEDE VER y que ESCRIBIÓ la persona denunciada.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly reports: ReportsRepository,
    private readonly users: UsersRepository,
    private readonly conversations: ConversationsRepository,
    private readonly attachments: AttachmentsRepository,
    private readonly statuses: StatusesRepository,
    private readonly media: MediaService,
    private readonly storage: BlobStorage,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async create(reporterId: string, input: CreateReportInput, now = new Date()): Promise<MyReportDto> {
    if (input.userId === reporterId) throw new BadRequestException({ code: 'CANNOT_REPORT_SELF', message: 'No podés denunciarte a vos mismo' });
    const target = await this.users.findById(input.userId);
    if (!target || target.status === 'deleted') throw new NotFoundException(USER_NOT_FOUND);
    if (await this.reports.hasPending(reporterId, target.id)) {
      throw new ConflictException({ code: 'REPORT_ALREADY_OPEN', message: 'Ya denunciaste a esta persona y soporte todavía lo está revisando' });
    }
    if ((await this.reports.countSentSince(reporterId, new Date(now.getTime() - DAY_MS))) >= REPORTS_PER_DAY) {
      throw new HttpException({ code: 'REPORTS_DAILY_LIMIT', message: `Podés enviar hasta ${REPORTS_PER_DAY} denuncias por día` }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const reportId = randomUUID();
    const collected: CollectedEvidence[] = [];
    try {
      for (const item of input.evidence) {
        collected.push(
          item.type === 'message'
            ? await this.copyMessage(reporterId, target.id, reportId, item.id, item.reveal)
            : await this.copyStatus(reporterId, target.id, reportId, item.id, now),
        );
      }
      const created = await this.reports.createWithEvidence(
        {
          id: reportId,
          reporterId,
          targetId: target.id,
          reason: input.reason,
          descriptionEncrypted: this.crypto.encryptText(input.description, reportAad(reportId)),
        },
        collected.map((item) => item.row),
      );
      await this.audit.log('report.created', { userId: reporterId, meta: { reportId, targetId: target.id, reason: input.reason, evidence: collected.length } });
      return {
        id: created.id,
        user: { id: target.id, displayName: target.displayName, avatarUrl: target.avatarUrl },
        reason: created.reason,
        reviewed: false,
        evidenceCount: collected.length,
        createdAt: created.createdAt.toISOString(),
      };
    } catch (error) {
      // Si algo falla, no quedan archivos copiados sueltos en el almacenamiento.
      await this.deleteBlobs(collected.flatMap((item) => (item.storageKey ? [item.storageKey] : [])));
      throw error;
    }
  }

  async listMine(reporterId: string): Promise<MyReportDto[]> {
    const rows = await this.reports.listByReporter(reporterId);
    return rows.map(({ report, target, evidenceCount }) => {
      const gone = target.status === 'deleted';
      return {
        id: report.id,
        // Si la cuenta denunciada se dio de baja (anonimizada), se muestra de forma neutra.
        user: { id: target.id, displayName: gone ? 'Cuenta eliminada' : target.displayName, avatarUrl: gone ? null : target.avatarUrl },
        reason: report.reason,
        reviewed: report.status !== 'pending',
        evidenceCount,
        createdAt: report.createdAt.toISOString(),
      };
    });
  }

  /** Un mensaje que ESCRIBIÓ la persona denunciada, en un chat donde quien denuncia ES MIEMBRO. */
  private async copyMessage(reporterId: string, targetId: string, reportId: string, messageId: string, reveal?: Reveal): Promise<CollectedEvidence> {
    const message = await this.conversations.findMessage(messageId);
    if (!message || message.senderId !== targetId || message.callId || !(await this.conversations.getMemberRole(message.conversationId, reporterId))) {
      throw new BadRequestException(INVALID_EVIDENCE);
    }
    if (message.e2ee) return this.copyE2eeMessage(reportId, message, reveal);
    if (reveal) throw new BadRequestException(INVALID_EVIDENCE);
    const id = randomUUID();
    const [attachment] = await this.attachments.findByMessageIds([message.id]);
    const base: NewReportEvidenceRow = {
      id,
      reportId,
      source: 'message',
      sourceId: message.id,
      kind: attachment ? attachment.kind : message.stickerCode ? 'sticker' : 'text',
      bodyEncrypted: this.crypto.encryptText(this.decryptOrEmpty(message.body, message.conversationId), evidenceAad(id)),
      stickerCode: message.stickerCode,
      originalCreatedAt: message.createdAt,
    };
    if (!attachment) return { row: base, storageKey: null };
    const storageKey = await this.copyBlob(attachment.storageKey, attachment.id, id);
    return {
      row: { ...base, storageKey, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, width: attachment.width, height: attachment.height, durationMs: attachment.durationMs },
      storageKey,
    };
  }

  /**
   * Mensaje cifrado de extremo a extremo: el servidor NO puede leerlo, así que el dispositivo de quien
   * denuncia revela el contenido y la clave de franqueo. Se acepta solo si el HMAC coincide con el
   * compromiso que guardó el servidor al recibir el mensaje: así nadie puede inventar ni editar evidencia.
   */
  private async copyE2eeMessage(reportId: string, message: MessageRow, reveal?: Reveal): Promise<CollectedEvidence> {
    if (!reveal || !message.franking || !(await verifyFranking(reveal.fk, reveal.content, message.franking))) {
      throw new BadRequestException(INVALID_EVIDENCE);
    }
    let content: E2eeContent;
    try {
      content = parseE2eeContent(reveal.content);
    } catch {
      throw new BadRequestException(INVALID_EVIDENCE);
    }
    const id = randomUUID();
    const base: NewReportEvidenceRow = {
      id,
      reportId,
      source: 'message',
      sourceId: message.id,
      kind: content.t === 'text' ? 'text' : content.t === 'sticker' ? 'sticker' : content.file.kind,
      bodyEncrypted: this.crypto.encryptText(content.t === 'sticker' ? '' : content.body, evidenceAad(id)),
      stickerCode: content.t === 'sticker' ? content.code : null,
      verified: true,
      originalCreatedAt: message.createdAt,
    };
    if (content.t !== 'file') return { row: base, storageKey: null };
    // Los adjuntos cifrados de extremo a extremo llegan en el paso siguiente (7B.3).
    throw new BadRequestException(INVALID_EVIDENCE);
  }

  /** Un estado de la persona denunciada que quien denuncia PUEDE VER ahora (vigente, sin bloqueo y con permiso). */
  private async copyStatus(reporterId: string, targetId: string, reportId: string, statusId: string, now: Date): Promise<CollectedEvidence> {
    const status = await this.statuses.findVisible(statusId, reporterId, now);
    if (!status || status.ownerId !== targetId) throw new BadRequestException(INVALID_EVIDENCE);
    const id = randomUUID();
    const base: NewReportEvidenceRow = {
      id,
      reportId,
      source: 'status',
      sourceId: status.id,
      kind: status.kind,
      bodyEncrypted: this.crypto.encryptText(this.decryptOrEmpty(status.bodyEncrypted, statusAad(status.id)), evidenceAad(id)),
      originalCreatedAt: status.createdAt,
    };
    if (!status.storageKey) return { row: base, storageKey: null };
    const storageKey = await this.copyBlob(status.storageKey, statusAad(status.id), id);
    return {
      row: { ...base, storageKey, mimeType: status.mimeType, sizeBytes: status.sizeBytes, width: status.width, height: status.height, durationMs: status.durationMs },
      storageKey,
    };
  }

  /** Descifra el archivo original y lo vuelve a cifrar con la clave propia de la evidencia. */
  private async copyBlob(sourceKey: string, sourceAad: string, evidenceId: string): Promise<string> {
    let data: Buffer;
    try {
      data = await this.media.readBlob(sourceKey, sourceAad);
    } catch {
      throw new BadRequestException(INVALID_EVIDENCE);
    }
    const storageKey = randomUUID();
    await this.storage.put(storageKey, this.crypto.encryptBlob(data, evidenceAad(evidenceId)));
    return storageKey;
  }

  private decryptOrEmpty(encrypted: string, aad: string): string {
    try {
      return this.crypto.decryptText(encrypted, aad);
    } catch {
      return '';
    }
  }

  private async deleteBlobs(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage.delete(key).catch((error: Error) => this.logger.error(`No se pudo borrar un archivo: ${error.message}`));
    }
  }
}
