'use client';

import type { SelfUser, StatusPrivacyDto } from '@qemzagram/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BlockedUsersDialog } from '@/components/BlockedUsersDialog';
import { MyReportsDialog } from '@/components/MyReportsDialog';
import { SecuritySettings } from '@/components/SecuritySettings';
import { Modal } from '@/components/Modal';
import { AUDIENCE_LABELS, StatusPrivacyDialog } from '@/components/status/StatusPrivacyDialog';
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePreferences, type ChatBackground, type FontSize, type ThemeMode } from '@/lib/preferences';

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];
const FONTS: { value: FontSize; label: string }[] = [
  { value: 'sm', label: 'Chico' },
  { value: 'md', label: 'Mediano' },
  { value: 'lg', label: 'Grande' },
];
const BACKGROUNDS: { value: ChatBackground; label: string }[] = [
  { value: 'plain', label: 'Liso' },
  { value: 'soft', label: 'Degradé' },
  { value: 'dots', label: 'Puntos' },
  { value: 'waves', label: 'Ondas' },
];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} data-active={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function privacySummary(privacy: StatusPrivacyDto): string {
  if (privacy.audience === 'except') return `${AUDIENCE_LABELS.except} (${privacy.except.length} ${privacy.except.length === 1 ? 'persona excluida' : 'personas excluidas'})`;
  if (privacy.audience === 'only') return `${AUDIENCE_LABELS.only} (${privacy.only.length} ${privacy.only.length === 1 ? 'persona' : 'personas'})`;
  return 'Mi agenda (personas que también te agregaron)';
}

function pushHint(state: PushState | null): string {
  switch (state) {
    case 'unsupported':
      return 'Este navegador no admite notificaciones. En iPhone, instalá la app desde "Compartir → Agregar a inicio".';
    case 'unavailable':
      return 'Las notificaciones no están activadas en el servidor.';
    case 'denied':
      return 'Bloqueaste las notificaciones: habilitalas desde la configuración del navegador.';
    case 'enabled':
      return 'Te avisamos en este dispositivo aunque la app esté cerrada.';
    default:
      return 'Recibí un aviso en este dispositivo aunque la app esté cerrada. Nunca incluye tus mensajes.';
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, setUser, logout } = useAuth();
  const { preferences, update } = usePreferences();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'pause' | 'delete' | null>(null);
  const [statusPrivacy, setStatusPrivacy] = useState<StatusPrivacyDto | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    getPushState()
      .then(setPushState)
      .catch(() => setPushState('unavailable'));
  }, []);

  async function togglePush(next: boolean) {
    setPushBusy(true);
    setError(null);
    try {
      if (next) setPushState(await enablePush());
      else {
        await disablePush();
        setPushState('disabled');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    api<StatusPrivacyDto>('/statuses/privacy')
      .then(setStatusPrivacy)
      .catch(() => undefined);
  }, []);

  if (!user) return null;

  async function togglePrivate(next: boolean) {
    setError(null);
    try {
      setUser(await api<SelfUser>('/users/me', { method: 'PATCH', body: { isPrivate: next } }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="page">
      <h1>Ajustes</h1>

      <section className="card">
        <h3>Apariencia</h3>
        <div className="setting">
          <div>
            <strong>Tema</strong>
            <small>Claro, oscuro o según tu dispositivo.</small>
          </div>
          <Segmented label="Tema" value={preferences.theme} options={THEMES} onChange={(theme) => update({ theme })} />
        </div>
        <div className="setting">
          <div>
            <strong>Tamaño del texto</strong>
            <small>Se aplica en toda la app.</small>
          </div>
          <Segmented label="Tamaño del texto" value={preferences.fontSize} options={FONTS} onChange={(fontSize) => update({ fontSize })} />
        </div>
        <div className="setting">
          <div>
            <strong>Fondo de los chats</strong>
            <small>Elegí el estilo de tus conversaciones.</small>
          </div>
          <Segmented label="Fondo de chat" value={preferences.chatBackground} options={BACKGROUNDS} onChange={(chatBackground) => update({ chatBackground })} />
        </div>
        <div className="chat-preview messages" aria-hidden="true">
          <div className="message-row"><div className="bubble"><span className="bubble-text">¡Hola! Así se ve tu fondo.</span><time>10:24</time></div></div>
          <div className="message-row" data-mine="true"><div className="bubble"><span className="bubble-text">Se ve genial 🔴⚪</span><time>10:25</time></div></div>
        </div>
      </section>

      <section className="card">
        <h3>Notificaciones</h3>
        <div className="setting">
          <div>
            <strong>Avisarme de llamadas entrantes</strong>
            <small>{pushHint(pushState)}</small>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={pushState === 'enabled'}
              disabled={pushBusy || pushState === null || pushState === 'unsupported' || pushState === 'unavailable' || pushState === 'denied'}
              onChange={(event) => void togglePush(event.target.checked)}
              aria-label="Avisarme de llamadas entrantes"
            />
            <span />
          </label>
        </div>
      </section>

      <section className="card">
        <h3>Privacidad</h3>
        <div className="setting">
          <div>
            <strong>Cuenta privada</strong>
            <small>Solo quienes agregaste a tu agenda ven tu biografía y tu portada. Tu foto, nombre y tag siempre son visibles para poder encontrarte.</small>
          </div>
          <label className="switch">
            <input type="checkbox" checked={user.isPrivate} onChange={(event) => togglePrivate(event.target.checked)} aria-label="Cuenta privada" />
            <span />
          </label>
        </div>
        <div className="setting">
          <div>
            <strong>Quién puede ver mis estados</strong>
            <small>
              {statusPrivacy ? privacySummary(statusPrivacy) : 'Tu agenda, o la parte de tu agenda que elijas.'}
            </small>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setPrivacyOpen(true)}>
            Cambiar
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Personas bloqueadas</strong>
            <small>No pueden escribirte, llamarte, agregarte ni ver tus estados. No se les avisa.</small>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setBlockedOpen(true)}>
            Ver
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Mis denuncias</strong>
            <small>Las denuncias que hiciste y si soporte ya las revisó.</small>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setReportsOpen(true)}>
            Ver
          </button>
        </div>
        {blockedOpen && <BlockedUsersDialog onClose={() => setBlockedOpen(false)} />}
        {reportsOpen && <MyReportsDialog onClose={() => setReportsOpen(false)} />}
        {privacyOpen && (
          <StatusPrivacyDialog
            onClose={() => setPrivacyOpen(false)}
            onSaved={(saved) => {
              setStatusPrivacy(saved);
              setPrivacyOpen(false);
            }}
          />
        )}
        {error && <p className="alert alert-error">{error}</p>}
      </section>

      <SecuritySettings />

      <section className="card">
        <h3>Cuenta</h3>
        <div className="setting">
          <div>
            <strong>Suspender cuenta temporalmente</strong>
            <small>Tu perfil se oculta y se cierra tu sesión. Se reactiva sola cuando vuelvas a iniciar sesión.</small>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('pause')}>
            Suspender
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Dar de baja mi cuenta</strong>
            <small>Elimina de forma definitiva tus datos personales y libera tu tag. No se puede deshacer.</small>
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirm('delete')}>
            Dar de baja
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Cerrar sesión</strong>
            <small>Salir de este dispositivo.</small>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </section>

      {confirm && (
        <ConfirmPasswordDialog
          action={confirm}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setUser(null);
            router.replace('/login');
          }}
        />
      )}
    </div>
  );
}

function ConfirmPasswordDialog({ action, onClose, onDone }: { action: 'pause' | 'delete'; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDelete = action === 'delete';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/users/me/${action}`, { body: { password } });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal title={isDelete ? 'Dar de baja mi cuenta' : 'Suspender mi cuenta'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">
          {isDelete
            ? 'Se eliminarán tu correo, nombre, fotos y biografía, y tu tag quedará libre. Esta acción es permanente.'
            : 'Tu cuenta quedará oculta hasta que vuelvas a iniciar sesión.'}
        </p>
        <div className="field">
          <label htmlFor="confirm-password">Confirmá con tu contraseña</label>
          <input id="confirm-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </div>
        {isDelete && (
          <div className="field">
            <label htmlFor="confirm-word">Escribí ELIMINAR para continuar</label>
            <input id="confirm-word" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
          </div>
        )}
        {error && <p className="alert alert-error">{error}</p>}
        <button className={isDelete ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy || !password || (isDelete && typed !== 'ELIMINAR')}>
          {busy ? 'Procesando…' : isDelete ? 'Dar de baja definitivamente' : 'Suspender'}
        </button>
      </form>
    </Modal>
  );
}
