'use client';

import {
  GENERAL_STICKER_LABELS,
  REPORT_REASON_LABELS,
  REPORTS_TO_BAN,
  type AppealStatus,
  type ReportStatus,
  type ResolveReportResultDto,
  type SupportAppealDto,
  type SupportEvidenceDto,
  type SupportReportDetailDto,
  type SupportReportDto,
  type SupportStatsDto,
  type SupportUserDto,
  type SupportUserRef,
} from '@qemzagram/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Tab = 'reports' | 'appeals' | 'users' | 'stats';

const TABS: { value: Tab; label: string }[] = [
  { value: 'reports', label: 'Denuncias' },
  { value: 'appeals', label: 'Apelaciones' },
  { value: 'users', label: 'Cuentas' },
  { value: 'stats', label: 'Estadísticas' },
];

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = { pending: 'Pendientes', confirmed: 'Confirmadas', dismissed: 'Descartadas' };
const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = { pending: 'Pendientes', accepted: 'Aceptadas', rejected: 'Rechazadas' };
const ACCOUNT_STATUS_LABELS: Record<SupportUserRef['status'], string> = { active: 'Activa', paused: 'Pausada', banned: 'Dada de baja', deleted: 'Eliminada' };

const formatDate = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const who = (user: SupportUserRef) => `${user.displayName} (@${user.tag})`;

/**
 * Panel de soporte. Solo trabaja con denuncias (y la evidencia que eligió quien denunció),
 * apelaciones, fichas de cuenta y estadísticas agregadas. NO hay forma de abrir un chat desde acá.
 * La API vuelve a verificar el rol en cada petición: ocultar esta pantalla es solo comodidad.
 */
export function SupportScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('reports');

  if (user?.role !== 'support') {
    return (
      <div className="page">
        <p className="alert alert-error">No encontrado.</p>
      </div>
    );
  }

  if (!user.mfaEnabled) {
    return (
      <div className="page">
        <h1>Soporte</h1>
        <p className="alert alert-error">Para usar el panel de soporte tenés que activar la verificación en dos pasos en Ajustes → Seguridad.</p>
      </div>
    );
  }

  return (
    <div className="page support-page">
      <h1>Soporte</h1>
      <p className="muted small">Desde acá no se pueden leer conversaciones: solo la evidencia que adjuntó quien denunció.</p>
      <div className="segmented support-tabs" role="tablist">
        {TABS.map((item) => (
          <button key={item.value} role="tab" aria-selected={tab === item.value} data-active={tab === item.value} onClick={() => setTab(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'reports' && <ReportsTab />}
      {tab === 'appeals' && <AppealsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}

// ---------- denuncias ----------

function ReportsTab() {
  const [status, setStatus] = useState<ReportStatus>('pending');
  const [items, setItems] = useState<SupportReportDto[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    api<SupportReportDto[]>(`/support/reports?status=${status}`)
      .then(setItems)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, [status]);
  useEffect(load, [load]);

  return (
    <section>
      <StatusFilter value={status} labels={REPORT_STATUS_LABELS} onChange={setStatus} />
      {error && <p className="alert alert-error">{error}</p>}
      {items === null && !error && <p className="muted">Cargando…</p>}
      {items?.length === 0 && <p className="empty-card">No hay denuncias {REPORT_STATUS_LABELS[status].toLowerCase()}.</p>}
      <ul className="support-list">
        {items?.map((item) => (
          <li key={item.id}>
            <button className="card support-item" onClick={() => setOpen(item.id)}>
              <strong>{REPORT_REASON_LABELS[item.reason]}</strong>
              <span>
                Contra <b>{who(item.target)}</b> · {item.target.confirmedReports}/{REPORTS_TO_BAN} confirmadas
              </span>
              <small className="muted">
                De {who(item.reporter)} · {formatDate(item.createdAt)} · {item.evidenceCount} adjuntos
              </small>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <ReportDetail
          id={open}
          onClose={() => setOpen(null)}
          onResolved={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function ReportDetail({ id, onClose, onResolved }: { id: string; onClose: () => void; onResolved: () => void }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<SupportReportDetailDto | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveReportResultDto | null>(null);

  useEffect(() => {
    api<SupportReportDetailDto>(`/support/reports/${id}`)
      .then(setDetail)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, [id]);

  async function resolve(decision: 'confirm' | 'dismiss') {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<ResolveReportResultDto>(`/support/reports/${id}/resolve`, { body: { decision, note } }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal title="Denuncia resuelta" onClose={onResolved}>
        <p>
          {result.report.status === 'confirmed' ? 'Confirmaste la denuncia.' : 'Descartaste la denuncia y se borró su evidencia.'}{' '}
          {result.targetBanned && <b>La cuenta {who(result.report.target)} alcanzó {REPORTS_TO_BAN} denuncias confirmadas y quedó dada de baja. Le avisamos por correo cómo apelar.</b>}
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onResolved}>
            Listo
          </button>
        </div>
      </Modal>
    );
  }

  const involved = detail && (detail.reporter.id === user?.id || detail.target.id === user?.id);
  return (
    <Modal title="Denuncia" onClose={onClose}>
      {!detail && !error && <p className="muted">Cargando…</p>}
      {detail && (
        <div className="support-detail">
          <p>
            <b>{REPORT_REASON_LABELS[detail.reason]}</b> · {formatDate(detail.createdAt)}
          </p>
          <p>
            Denunciada: <b>{who(detail.target)}</b> ({ACCOUNT_STATUS_LABELS[detail.target.status]}, {detail.target.confirmedReports}/{REPORTS_TO_BAN} confirmadas)
            <br />
            Denunció: {who(detail.reporter)}
          </p>
          {detail.description && <blockquote className="support-quote">{detail.description}</blockquote>}
          <h3 className="section-title">Evidencia elegida por quien denunció ({detail.evidence.length})</h3>
          {detail.evidence.length === 0 && <p className="muted small">No adjuntó mensajes.</p>}
          <ul className="support-evidence">
            {detail.evidence.map((item) => (
              <EvidenceItem key={item.id} item={item} />
            ))}
          </ul>
          {detail.status === 'pending' && !involved && (
            <>
              <div className="field">
                <label htmlFor="support-note">Nota interna (opcional)</label>
                <textarea id="support-note" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => void resolve('dismiss')} disabled={busy}>
                  Descartar
                </button>
                <button className="btn btn-danger" onClick={() => void resolve('confirm')} disabled={busy}>
                  Confirmar
                </button>
              </div>
            </>
          )}
          {involved && <p className="alert alert-error">Sos parte de esta denuncia: tiene que resolverla otra persona de soporte.</p>}
        </div>
      )}
      {error && <p className="alert alert-error">{error}</p>}
    </Modal>
  );
}

function EvidenceItem({ item }: { item: SupportEvidenceDto }) {
  const media = item.media;
  return (
    <li className="card">
      <small className="muted">
        {item.source === 'status' ? 'Estado' : 'Mensaje'} · {formatDate(item.originalCreatedAt)}
      </small>
      {item.verified && (
        <small className="badge" title="Mensaje cifrado de extremo a extremo: el franqueo confirma que lo envió esta persona y que no fue editado">
          Autenticidad verificada
        </small>
      )}
      {item.sticker && <p>Sticker: {GENERAL_STICKER_LABELS[item.sticker]}</p>}
      {item.kind === 'malware' && <p className="alert alert-error">El archivo adjunto tenía malware: el antivirus lo bloqueó y no se guardó.</p>}
      {media && media.mimeType.startsWith('image/') && <img src={media.url} alt="Evidencia" className="support-media" />}
      {media && media.mimeType.startsWith('video/') && <video src={media.url} controls className="support-media" />}
      {media && media.mimeType.startsWith('audio/') && <audio src={media.url} controls />}
      {media && !/^(image|video|audio)\//.test(media.mimeType) && (
        <a href={media.url} className="btn btn-ghost btn-sm" download>
          Descargar archivo
        </a>
      )}
      {item.body && <p className="support-body">{item.body}</p>}
    </li>
  );
}

// ---------- apelaciones ----------

function AppealsTab() {
  const [status, setStatus] = useState<AppealStatus>('pending');
  const [items, setItems] = useState<SupportAppealDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    api<SupportAppealDto[]>(`/support/appeals?status=${status}`)
      .then(setItems)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, [status]);
  useEffect(load, [load]);

  async function resolve(item: SupportAppealDto, decision: 'accept' | 'reject') {
    setBusy(item.id);
    setError(null);
    try {
      await api(`/support/appeals/${item.id}/resolve`, { body: { decision } });
      setNotice(decision === 'accept' ? `Reactivaste la cuenta ${who(item.user)}.` : `La baja de ${who(item.user)} se mantiene.`);
      load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <StatusFilter value={status} labels={APPEAL_STATUS_LABELS} onChange={setStatus} />
      {notice && <p className="alert alert-ok">{notice}</p>}
      {error && <p className="alert alert-error">{error}</p>}
      {items === null && !error && <p className="muted">Cargando…</p>}
      {items?.length === 0 && <p className="empty-card">No hay apelaciones {APPEAL_STATUS_LABELS[status].toLowerCase()}.</p>}
      <ul className="support-list">
        {items?.map((item) => (
          <li key={item.id} className="card support-item">
            <strong>{who(item.user)}</strong>
            <small className="muted">
              {formatDate(item.createdAt)} · {item.confirmedReports} denuncias confirmadas
            </small>
            <blockquote className="support-quote">{item.message}</blockquote>
            {item.status === 'pending' && (
              <div className="modal-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => void resolve(item, 'reject')} disabled={busy === item.id}>
                  Mantener la baja
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void resolve(item, 'accept')} disabled={busy === item.id}>
                  Reactivar la cuenta
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- cuentas ----------

function UsersTab() {
  const [tag, setTag] = useState('');
  const [found, setFound] = useState<SupportUserDto | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setFound(null);
    try {
      setFound(await api<SupportUserDto>(`/support/users?tag=${encodeURIComponent(tag.trim().replace(/^@/, ''))}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/support/users/${found.id}/password-reset`, { method: 'POST' });
      setNotice(`Enviamos el enlace para cambiar la contraseña a ${found.emailMasked}.`);
      setConfirmReset(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <form className="inline-form" onSubmit={search}>
        <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="@tag de la cuenta" autoCapitalize="none" maxLength={30} />
        <button className="btn btn-primary" disabled={busy || tag.trim().length < 3}>
          Buscar
        </button>
      </form>
      {error && <p className="alert alert-error">{error}</p>}
      {notice && <p className="alert alert-ok">{notice}</p>}
      {found && (
        <div className="card support-user">
          <strong>{who(found)}</strong>
          <dl>
            <dt>Estado</dt>
            <dd>{ACCOUNT_STATUS_LABELS[found.status]}</dd>
            <dt>Correo</dt>
            <dd>
              {found.emailMasked} {found.emailVerified ? '(verificado)' : '(sin verificar)'}
            </dd>
            <dt>Creada</dt>
            <dd>{formatDate(found.createdAt)}</dd>
            <dt>Denuncias</dt>
            <dd>
              {found.reports.pending} pendientes · {found.reports.confirmed} confirmadas
            </dd>
            {found.role === 'support' && (
              <>
                <dt>Rol</dt>
                <dd>Soporte</dd>
              </>
            )}
          </dl>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)} disabled={busy || found.status === 'banned' || !found.emailVerified}>
            Enviar enlace para cambiar la contraseña
          </button>
        </div>
      )}
      {confirmReset && found && (
        <Modal title="Reseteo asistido de contraseña" onClose={() => setConfirmReset(false)}>
          <p>
            Antes de seguir, verificá que hablás con la persona dueña de <b>@{found.tag}</b> (por ejemplo, que te escriba desde {found.emailMasked}).
          </p>
          <p className="muted small">El enlace va SOLO al correo registrado. Vos nunca ves ni elegís la contraseña.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmReset(false)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => void reset()} disabled={busy}>
              Enviar enlace
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------- estadísticas ----------

function StatsTab() {
  const [stats, setStats] = useState<SupportStatsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SupportStatsDto>('/support/stats')
      .then(setStats)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);

  if (error) return <p className="alert alert-error">{error}</p>;
  if (!stats) return <p className="muted">Cargando…</p>;
  const groups: { title: string; rows: [string, number][] }[] = [
    {
      title: 'Cuentas',
      rows: [
        ['Total', stats.users.total],
        ['Activas', stats.users.active],
        ['Pausadas', stats.users.paused],
        ['Dadas de baja', stats.users.banned],
        ['Eliminadas', stats.users.deleted],
        ['Nuevas (7 días)', stats.users.newLast7d],
        ['Nuevas (30 días)', stats.users.newLast30d],
      ],
    },
    {
      title: 'Actividad',
      rows: [
        ['Mensajes (24 h)', stats.activity.messagesLast24h],
        ['Mensajes (7 días)', stats.activity.messagesLast7d],
        ['Chats 1 a 1', stats.activity.directChats],
        ['Grupos', stats.activity.groups],
        ['Estados activos', stats.activity.activeStatuses],
        ['Llamadas (7 días)', stats.activity.callsLast7d],
        ['Visibles en "Cercanos"', stats.activity.nearbyVisibleNow],
      ],
    },
    {
      title: 'Moderación',
      rows: [
        ['Denuncias pendientes', stats.moderation.reportsPending],
        ['Denuncias confirmadas', stats.moderation.reportsConfirmed],
        ['Denuncias descartadas', stats.moderation.reportsDismissed],
        ['Apelaciones pendientes', stats.moderation.appealsPending],
        ['Bajas (30 días)', stats.moderation.bansLast30d],
      ],
    },
  ];
  return (
    <section>
      <p className="muted small">Solo números totales: ningún dato de una persona en particular. Actualizado: {formatDate(stats.generatedAt)}.</p>
      <div className="support-stats">
        {groups.map((group) => (
          <div key={group.title} className="card">
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map(([label, value]) => (
                <div key={label} className="support-stat">
                  <dt>{label}</dt>
                  <dd>{value.toLocaleString('es-AR')}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusFilter<T extends string>({ value, labels, onChange }: { value: T; labels: Record<T, string>; onChange: (next: T) => void }) {
  return (
    <div className="segmented support-filter">
      {(Object.keys(labels) as T[]).map((option) => (
        <button key={option} type="button" data-active={value === option} onClick={() => onChange(option)}>
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
