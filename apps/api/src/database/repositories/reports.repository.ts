import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { reportEvidence, reports, users, type NewReportEvidenceRow, type ReportEvidenceRow, type ReportRow, type UserRow } from '../schema';

export interface ReportWithTarget {
  report: ReportRow;
  target: UserRow;
  evidenceCount: number;
}

export type NewReport = Pick<ReportRow, 'id' | 'reporterId' | 'targetId' | 'reason' | 'descriptionEncrypted'>;

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

  async evidenceFor(reportId: string): Promise<ReportEvidenceRow[]> {
    return this.db.select().from(reportEvidence).where(eq(reportEvidence.reportId, reportId)).orderBy(reportEvidence.originalCreatedAt);
  }
}
