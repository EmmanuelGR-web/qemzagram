import type { CreateReportInput, MyReportDto, ReportEvidenceSource } from '@qemzagram/shared';
import { api } from './api';

/** Un mensaje o estado que se puede adjuntar como evidencia (lo elige quien denuncia). */
export interface EvidenceCandidate {
  type: ReportEvidenceSource;
  id: string;
  label: string;
  createdAt: string;
}

export const REPORT_EXPLANATION =
  'Soporte revisa cada denuncia. Solo ve lo que vos elijas adjuntar (nunca el resto del chat) y la otra persona no se entera de quién la denunció.';

export function reportUser(input: CreateReportInput): Promise<MyReportDto> {
  return api<MyReportDto>('/reports', { body: input });
}

export function listMyReports(): Promise<MyReportDto[]> {
  return api<MyReportDto[]>('/reports/mine');
}
