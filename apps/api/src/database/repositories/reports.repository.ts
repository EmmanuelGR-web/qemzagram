import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, count, countDistinct, desc, eq, gte, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { reportEvidence, reports, users, type NewReportEvidenceRow, type ReportEvidenceRow, type ReportRow, type UserRow } from '../schema';

export interface ReportWithTarget {
  report: ReportRow;
  target: UserRow;
  evidenceCount: number;
}

export type NewReport = Pick<ReportRow, 'id' | 'reporterId' | 'targetId' | 'reason' | 'descriptionEncrypted'>;

export interface ReportForSupport {
  report: ReportRow;
  reporter: UserRow;
  target: UserRow;
}

const reporterUsers = aliasedTable(users, 'reporter_users');
const targetUsers = aliasedTable(users, 'target_users');

@Injectable()
export class ReportsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async countSentSince(reporterId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(reports)
      .where(and(eq(reports.reporterId, reporterId), gte(reports.createdAt, since)));
    return row?.total ?? 0;
  }

  async hasPending(reporterId: string, targetId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, reporterId), eq(reports.targetId, targetId), eq(reports.status, 'pending')))
      .limit(1);
    return Boolean(row);
  }

  /** Denuncia + evidencia en una sola transacción (o todo, o nada). */
  async createWithEvidence(report: NewReport, evidence: NewReportEvidenceRow[]): Promise<ReportRow> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(reports).values(report).returning();
      if (!created) throw new Error('No se pudo guardar la denuncia');
      if (evidence.length > 0) await tx.insert(reportEvidence).values(evidence);
      return created;
    });
  }

  async listByReporter(reporterId: string, limit = 100): Promise<ReportWithTarget[]> {
    const rows = await this.db
      .select({ report: reports, target: users })
      .from(reports)
      .innerJoin(users, eq(users.id, reports.targetId))
      .where(eq(reports.reporterId, reporterId))
      .orderBy(desc(reports.createdAt))
      .limit(limit);
    const counts = await this.evidenceCounts(rows.map((row) => row.report.id));
    return rows.map((row) => ({ ...row, evidenceCount: counts.get(row.report.id) ?? 0 }));
  }

  async evidenceCounts(reportIds: string[]): Promise<Map<string, number>> {
    if (reportIds.length === 0) return new Map();
    const rows = await this.db
      .select({ reportId: reportEvidence.reportId, total: count() })
      .from(reportEvidence)
      .where(inArray(reportEvidence.reportId, reportIds))
      .groupBy(reportEvidence.reportId);
    return new Map(rows.map((row) => [row.reportId, row.total]));
  }

  // ---------- soporte ----------

  async listForSupport(status: ReportRow['status'], limit = 100): Promise<ReportForSupport[]> {
    return this.supportQuery()
      .where(eq(reports.status, status))
      .orderBy(status === 'pending' ? reports.createdAt : desc(reports.reviewedAt))
      .limit(limit);
  }

  async findForSupport(id: string): Promise<ReportForSupport | undefined> {
    const [row] = await this.supportQuery().where(eq(reports.id, id)).limit(1);
    return row;
  }

  private supportQuery() {
    return this.db
      .select({ report: reports, reporter: reporterUsers, target: targetUsers })
      .from(reports)
      .innerJoin(reporterUsers, eq(reporterUsers.id, reports.reporterId))
      .innerJoin(targetUsers, eq(targetUsers.id, reports.targetId))
      .$dynamic();
  }

  /** Resuelve SOLO si sigue pendiente (dos personas de soporte a la vez no la resuelven dos veces). */
  async resolve(id: string, status: 'confirmed' | 'dismissed', reviewerId: string, noteEncrypted: string | null): Promise<ReportRow | undefined> {
    const [row] = await this.db
      .update(reports)
      .set({ status, reviewedBy: reviewerId, reviewedAt: new Date(), reviewNoteEncrypted: noteEncrypted })
      .where(and(eq(reports.id, id), eq(reports.status, 'pending')))
      .returning();
    return row;
  }

  /** Cuántas personas DISTINTAS tienen una denuncia confirmada contra esta cuenta. */
  async countConfirmedReporters(targetId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: countDistinct(reports.reporterId) })
      .from(reports)
      .where(and(eq(reports.targetId, targetId), eq(reports.status, 'confirmed')));
    return row?.total ?? 0;
  }

  async confirmedReportersAmong(targetIds: string[]): Promise<Map<string, number>> {
    if (targetIds.length === 0) return new Map();
    const rows = await this.db
      .select({ targetId: reports.targetId, total: countDistinct(reports.reporterId) })
      .from(reports)
      .where(and(inArray(reports.targetId, targetIds), eq(reports.status, 'confirmed')))
      .groupBy(reports.targetId);
    return new Map(rows.map((row) => [row.targetId, row.total]));
  }

  async countsForTarget(targetId: string): Promise<{ pending: number; confirmed: number }> {
    const rows = await this.db
      .select({ status: reports.status, total: count() })
      .from(reports)
      .where(and(eq(reports.targetId, targetId), ne(reports.status, 'dismissed')))
      .groupBy(reports.status);
    const byStatus = new Map(rows.map((row) => [row.status, row.total]));
    return { pending: byStatus.get('pending') ?? 0, confirmed: byStatus.get('confirmed') ?? 0 };
  }

  /** Una apelación aceptada anula las denuncias confirmadas (si no, la próxima volvería a dar de baja). */
  async annulConfirmedFor(targetId: string, reviewerId: string): Promise<void> {
    await this.db
      .update(reports)
      .set({ status: 'dismissed', reviewedBy: reviewerId, reviewedAt: new Date() })
      .where(and(eq(reports.targetId, targetId), eq(reports.status, 'confirmed')));
  }

  async findEvidence(id: string): Promise<ReportEvidenceRow | undefined> {
    const [row] = await this.db.select().from(reportEvidence).where(eq(reportEvidence.id, id)).limit(1);
    return row;
  }

  /** Borra la evidencia de UNA denuncia y devuelve las claves de archivos a borrar del almacenamiento. */
  async deleteEvidenceFor(reportId: string): Promise<string[]> {
    const rows = await this.db.delete(reportEvidence).where(eq(reportEvidence.reportId, reportId)).returning({ storageKey: reportEvidence.storageKey });
    return rows.flatMap((row) => (row.storageKey ? [row.storageKey] : []));
  }

  /** Evidencia de denuncias resueltas antes de `before` (retención limitada). */
  async deleteEvidenceResolvedBefore(before: Date): Promise<string[]> {
    const old = this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(ne(reports.status, 'pending'), isNotNull(reports.reviewedAt), lt(reports.reviewedAt, before)));
    const rows = await this.db.delete(reportEvidence).where(inArray(reportEvidence.reportId, old)).returning({ storageKey: reportEvidence.storageKey });
    return rows.flatMap((row) => (row.storageKey ? [row.storageKey] : []));
  }

  async evidenceFor(reportId: string): Promise<ReportEvidenceRow[]> {
    return this.db.select().from(reportEvidence).where(eq(reportEvidence.reportId, reportId)).orderBy(reportEvidence.originalCreatedAt);
  }
}
