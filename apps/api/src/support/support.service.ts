import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  REPORTS_TO_BAN,
  type GeneralStickerCode,
  type ResolveAppealInput,
  type ResolveReportInput,
  type ResolveReportResultDto,
  type SupportAppealDto,
  type SupportEvidenceDto,
  type SupportReportDetailDto,
  type SupportReportDto,
  type SupportStatsDto,
  type SupportUserDto,
  type SupportUserRef,
} from '@qemzagram/shared';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AppealsRepository } from '../database/repositories/appeals.repository';
import { ReportsRepository, type ReportForSupport } from '../database/repositories/reports.repository';
import { SessionsRepository } from '../database/repositories/sessions.repository';
import { SupportStatsRepository } from '../database/repositories/support-stats.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { ReportEvidenceRow, UserRow } from '../database/schema';
import { MailPort } from '../mail/mail.port';
import { maskEmail } from '../mail/smtp-mail.service';
import { MediaUrlService } from '../media/media-url.service';
import { evidenceAad } from '../media/media.service';
import { NearbyService } from '../nearby/nearby.service';
import { PushService } from '../notifications/push.service';
import { RealtimePublisher } from '../realtime/realtime.port';
import { reportAad } from '../reports/reports.service';
import { BlobStorage } from '../storage/blob-storage.port';

const REPORT_NOT_FOUND = { code: 'REPORT_NOT_FOUND', message: 'No encontramos esa denuncia' };
const APPEAL_NOT_FOUND = { code: 'APPEAL_NOT_FOUND', message: 'No encontramos esa apelación' };
const USER_NOT_FOUND = { code: 'USER_NOT_FOUND', message: 'No encontramos esa cuenta' };
/** Nadie revisa denuncias ni apelaciones en las que es parte. */
const SELF_REVIEW = { code: 'SELF_REVIEW', message: 'No podés resolver algo en lo que sos parte: pedíselo a otra persona de soporte' };
const DAY_MS = 24 * 60 * 60 * 1000;

const toRef = (user: UserRow): SupportUserRef => ({ id: user.id, tag: user.tag, displayName: user.displayName, status: user.status });

/**
 * Panel de soporte. Regla de seguridad 10: el rol de soporte JAMÁS lee conversaciones.
 * Ningún método de este servicio toca mensajes ni chats: solo denuncias (con la COPIA de evidencia
 * que eligió quien denunció), apelaciones, fichas de cuenta y conteos agregados.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly reports: ReportsRepository,
    private readonly appeals: AppealsRepository,
    private readonly stats: SupportStatsRepository,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly auth: AuthService,
    private readonly nearby: NearbyService,
    private readonly push: PushService,
    private readonly realtime: RealtimePublisher,
    private readonly mail: MailPort,
    private readonly urls: MediaUrlService,
    private readonly storage: BlobStorage,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ---------- estadísticas ----------

  async getStats(now = new Date()): Promise<SupportStatsDto> {
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [byStatus, new7, new30, msg24h, msg7d, byType, activeStatuses, calls7d, nearby, reportsByStatus, appealsPending, bans30] = await Promise.all([
      this.stats.usersByStatus(),
      this.stats.usersCreatedSince(ago(7)),
      this.stats.usersCreatedSince(ago(30)),
      this.stats.messagesSince(ago(1)),
      this.stats.messagesSince(ago(7)),
      this.stats.conversationsByType(),
      this.stats.activeStatuses(now),
      this.stats.callsSince(ago(7)),
      this.stats.nearbyVisible(now),
      this.stats.reportsByStatus(),
      this.stats.pendingAppeals(),
      this.stats.auditEventsSince('user.banned', ago(30)),
    ]);
    const statusCount = (status: string) => byStatus.get(status) ?? 0;
    return {
      users: {
        total: [...byStatus.values()].reduce((sum, value) => sum + value, 0),
        active: statusCount('active'),
        paused: statusCount('paused'),
        banned: statusCount('banned'),
        deleted: statusCount('deleted'),
        newLast7d: new7,
        newLast30d: new30,
      },
      activity: {
        messagesLast24h: msg24h,
        messagesLast7d: msg7d,
        directChats: byType.get('direct') ?? 0,
        groups: byType.get('group') ?? 0,
        activeStatuses,
        callsLast7d: calls7d,
        nearbyVisibleNow: nearby,
      },
      moderation: {
        reportsPending: reportsByStatus.get('pending') ?? 0,
        reportsConfirmed: reportsByStatus.get('confirmed') ?? 0,
        reportsDismissed: reportsByStatus.get('dismissed') ?? 0,
        appealsPending,
        bansLast30d: bans30,
      },
      generatedAt: now.toISOString(),
    };
  }

  // ---------- denuncias ----------

  async listReports(status: SupportReportDto['status']): Promise<SupportReportDto[]> {
    const rows = await this.reports.listForSupport(status);
    const [evidence, confirmed] = await Promise.all([
      this.reports.evidenceCounts(rows.map((row) => row.report.id)),
      this.reports.confirmedReportersAmong([...new Set(rows.map((row) => row.target.id))]),
    ]);
    return rows.map((row) => this.toReportDto(row, evidence.get(row.report.id) ?? 0, confirmed.get(row.target.id) ?? 0));
  }

  async getReport(supportId: string, id: string): Promise<SupportReportDetailDto> {
    const row = await this.reports.findForSupport(id);
    if (!row) throw new NotFoundException(REPORT_NOT_FOUND);
    const [evidence, confirmed] = await Promise.all([this.reports.evidenceFor(id), this.reports.countConfirmedReporters(row.target.id)]);
    // Ver evidencia es sensible: queda registrado quién la miró.
    await this.audit.log('support.report_viewed', { userId: supportId, meta: { reportId: id } });
    return { ...this.toReportDto(row, evidence.length, confirmed), evidence: evidence.map((item) => this.toEvidenceDto(item)) };
  }

  /**
   * Confirmar o descartar. Al confirmar, si la cuenta suma REPORTS_TO_BAN denuncias confirmadas
   * de personas DISTINTAS, se da de baja. Al descartar, la evidencia se borra enseguida.
   */
  async resolveReport(supportId: string, id: string, input: ResolveReportInput): Promise<ResolveReportResultDto> {
    const current = await this.reports.findForSupport(id);
    if (!current) throw new NotFoundException(REPORT_NOT_FOUND);
    if (current.reporter.id === supportId || current.target.id === supportId) throw new ForbiddenException(SELF_REVIEW);

    const status = input.decision === 'confirm' ? 'confirmed' : 'dismissed';
    const note = input.note ? this.crypto.encryptText(input.note, reportAad(id)) : null;
    const resolved = await this.reports.resolve(id, status, supportId, note);
    if (!resolved) throw new ConflictException({ code: 'REPORT_ALREADY_RESOLVED', message: 'Esa denuncia ya fue resuelta' });
    await this.audit.log(status === 'confirmed' ? 'report.confirmed' : 'report.dismissed', { userId: supportId, meta: { reportId: id, targetId: current.target.id } });

    if (status === 'dismissed') await this.deleteBlobs(await this.reports.deleteEvidenceFor(id));

    let targetBanned = false;
    const confirmed = await this.reports.countConfirmedReporters(current.target.id);
    if (status === 'confirmed' && confirmed >= REPORTS_TO_BAN && (current.target.status === 'active' || current.target.status === 'paused')) {
      await this.ban(current.target, supportId, confirmed);
      targetBanned = true;
    }
    const fresh = await this.reports.findForSupport(id);
    if (!fresh) throw new NotFoundException(REPORT_NOT_FOUND);
    return { report: this.toReportDto(fresh, (await this.reports.evidenceCounts([id])).get(id) ?? 0, confirmed), targetBanned };
  }

  /** Baja por incumplir las normas: cierra sesiones y conexiones, la saca de "cercanos" y le avisa por correo cómo apelar. */
  private async ban(target: UserRow, supportId: string, confirmedReports: number): Promise<void> {
    await this.users.update(target.id, { status: 'banned' });
    await this.sessions.revokeAllForUser(target.id);
    this.realtime.disconnectUser(target.id);
    await this.nearby.hide(target.id);
    await this.push.removeAllFor(target.id);
    await this.audit.log('user.banned', { userId: target.id, meta: { by: supportId, confirmedReports } });
    await this.mail.sendAccountBanned(target.email, target.displayName);
  }

  // ---------- apelaciones ----------

  async listAppeals(status: SupportAppealDto['status']): Promise<SupportAppealDto[]> {
    const rows = await this.appeals.list(status);
    const confirmed = await this.reports.confirmedReportersAmong([...new Set(rows.map((row) => row.user.id))]);
    return rows.map(({ appeal, user }) => ({
      id: appeal.id,
      user: toRef(user),
      message: this.decryptOrEmpty(appeal.messageEncrypted, `appeal:${appeal.id}`),
      status: appeal.status,
      confirmedReports: confirmed.get(user.id) ?? 0,
      createdAt: appeal.createdAt.toISOString(),
      reviewedAt: appeal.reviewedAt?.toISOString() ?? null,
    }));
  }

  /** Aceptar reactiva la cuenta y anula sus denuncias confirmadas; rechazar mantiene la baja. Siempre se avisa por correo. */
  async resolveAppeal(supportId: string, id: string, input: ResolveAppealInput): Promise<SupportAppealDto> {
    const current = await this.appeals.findWithUser(id);
    if (!current) throw new NotFoundException(APPEAL_NOT_FOUND);
    if (current.user.id === supportId) throw new ForbiddenException(SELF_REVIEW);

    const status = input.decision === 'accept' ? 'accepted' : 'rejected';
    const note = input.note ? this.crypto.encryptText(input.note, `appeal:${id}`) : null;
    const resolved = await this.appeals.resolve(id, status, supportId, note);
    if (!resolved) throw new ConflictException({ code: 'APPEAL_ALREADY_RESOLVED', message: 'Esa apelación ya fue resuelta' });

    if (status === 'accepted' && current.user.status === 'banned') {
      await this.users.update(current.user.id, { status: 'active', failedLogins: 0, lockedUntil: null });
      await this.reports.annulConfirmedFor(current.user.id, supportId);
      await this.audit.log('user.unbanned', { userId: current.user.id, meta: { by: supportId, appealId: id } });
    }
    await this.audit.log(status === 'accepted' ? 'appeal.accepted' : 'appeal.rejected', { userId: supportId, meta: { appealId: id, targetId: current.user.id } });
    await this.mail.sendAppealResult(current.user.email, current.user.displayName, status === 'accepted');

    const [fresh] = (await this.listAppeals(status)).filter((appeal) => appeal.id === id);
    if (!fresh) throw new NotFoundException(APPEAL_NOT_FOUND);
    return fresh;
  }

  // ---------- cuentas ----------

  /** Ficha de una cuenta: estado y denuncias. Sin mensajes, contactos ni correo completo. */
  async lookupUser(supportId: string, tag: string): Promise<SupportUserDto> {
    const user = await this.users.findByTag(tag.replace(/^@/, ''));
    if (!user || user.status === 'deleted') throw new NotFoundException(USER_NOT_FOUND);
    await this.audit.log('support.user_lookup', { userId: supportId, meta: { targetId: user.id } });
    return this.toUserDto(user);
  }

  /**
   * Reseteo asistido: después de verificar la identidad por otro canal, soporte pide que se envíe
   * el enlace al correo REGISTRADO. Soporte nunca ve, elige ni recibe la contraseña ni el enlace.
   */
  async assistedPasswordReset(supportId: string, userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.status === 'deleted') throw new NotFoundException(USER_NOT_FOUND);
    if (user.status === 'banned') throw new ConflictException({ code: 'ACCOUNT_BANNED', message: 'La cuenta está dada de baja: primero tiene que resolverse su apelación' });
    if (!user.emailVerifiedAt) throw new ConflictException({ code: 'EMAIL_NOT_VERIFIED', message: 'La cuenta todavía no verificó su correo' });
    await this.auth.issuePasswordReset(user);
    await this.audit.log('support.password_reset', { userId: supportId, meta: { targetId: user.id } });
  }

  // ---------- limpieza ----------

  /** Borra la evidencia de denuncias resueltas hace más de `days` días (y sus archivos). */
  async purgeOldEvidence(before: Date): Promise<number> {
    const keys = await this.reports.deleteEvidenceResolvedBefore(before);
    await this.deleteBlobs(keys);
    return keys.length;
  }

  // ---------- helpers ----------

  private async toUserDto(user: UserRow): Promise<SupportUserDto> {
    return {
      ...toRef(user),
      role: user.role,
      emailMasked: maskEmail(user.email),
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      reports: await this.reports.countsForTarget(user.id),
    };
  }

  private toReportDto(row: ReportForSupport, evidenceCount: number, confirmedReports: number): SupportReportDto {
    return {
      id: row.report.id,
      reason: row.report.reason,
      status: row.report.status,
      description: this.decryptOrEmpty(row.report.descriptionEncrypted, reportAad(row.report.id)),
      evidenceCount,
      reporter: toRef(row.reporter),
      target: { ...toRef(row.target), confirmedReports },
      createdAt: row.report.createdAt.toISOString(),
      reviewedAt: row.report.reviewedAt?.toISOString() ?? null,
    };
  }

  private toEvidenceDto(row: ReportEvidenceRow): SupportEvidenceDto {
    return {
      id: row.id,
      source: row.source,
      kind: row.kind,
      body: this.decryptOrEmpty(row.bodyEncrypted, evidenceAad(row.id)),
      sticker: (row.stickerCode as GeneralStickerCode | null) ?? null,
      media:
        row.storageKey && row.mimeType
          ? { url: this.urls.sign('r', row.id).url, mimeType: row.mimeType, width: row.width, height: row.height, durationMs: row.durationMs }
          : null,
      originalCreatedAt: row.originalCreatedAt.toISOString(),
    };
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
