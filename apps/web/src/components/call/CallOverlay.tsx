'use client';

import type { CallDto, PublicUser } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { GroupIcon, MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon, SwitchCameraIcon, VideoIcon, VideoOffIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth-context';
import { useCalls, type ActiveCall } from '@/lib/call-context';
import { formatDuration } from '@/lib/messages';
import { ParticipantTile } from './ParticipantTile';

/** Llamada entrante + pantalla de llamada. Se monta una sola vez en el layout de la app. */
export function CallOverlay() {
  const { incoming, active, error, clearError } = useCalls();
  return (
    <>
      {incoming && !active && <IncomingCall call={incoming} />}
      {active && <CallScreen session={active} />}
      {incoming && active && incoming.id !== active.call.id && <IncomingCall call={incoming} compact />}
      {error && (
        <div className="call-toast" role="alert">
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={clearError}>
            Cerrar
          </button>
        </div>
      )}
    </>
  );
}

/** Quién llama / cómo se llama el grupo. */
function useCallTitle(call: CallDto): { title: string; caller: PublicUser | undefined } {
  const caller = call.participants.find((participant) => participant.user.id === call.startedBy)?.user;
  return { title: call.title ?? caller?.displayName ?? 'Llamada', caller };
}

function IncomingCall({ call, compact = false }: { call: CallDto; compact?: boolean }) {
  const { accept, decline } = useCalls();
  const { title, caller } = useCallTitle(call);
  useRingtone(!compact);

  const label = `${call.kind === 'video' ? 'Videollamada' : 'Llamada'} entrante${call.conversationType === 'group' ? ` de ${caller?.displayName ?? 'alguien'}` : ''}`;
  return (
    <div className={compact ? 'call-incoming call-incoming-compact' : 'call-incoming'} role="alertdialog" aria-label={`${label}: ${title}`}>
      <div className="call-incoming-card">
        {call.conversationType === 'group' || !caller ? (
          <span className="group-avatar call-incoming-avatar">
            <GroupIcon />
          </span>
        ) : (
          <span className="call-pulse">
            <Avatar user={caller} size={compact ? 48 : 96} />
          </span>
        )}
        <div className="call-incoming-text">
          <strong>{title}</strong>
          <small>{label}</small>
        </div>
        <div className="call-incoming-actions">
          <button className="call-btn call-btn-danger" onClick={() => void decline(call)} aria-label="Rechazar">
            <PhoneOffIcon />
          </button>
          <button className="call-btn call-btn-accept" onClick={() => void accept(call)} aria-label="Atender">
            {call.kind === 'video' ? <VideoIcon /> : <PhoneIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CallScreen({ session }: { session: ActiveCall }) {
  const { user } = useAuth();
  const { revision, hangUp, toggleMicrophone, toggleCamera, switchCamera, audioBlocked, resumeAudio } = useCalls();
  const { call, room } = session;
  const { title } = useCallTitle(call);
  const elapsed = useElapsed(call.answeredAt);
  const profiles = new Map(call.participants.map((participant) => [participant.user.id, participant.user]));
  const remotes = [...room.remoteParticipants.values()];
  const local = room.localParticipant;
  const status =
    call.status === 'ringing' && remotes.length === 0
      ? 'Llamando…'
      : remotes.length === 0
        ? call.conversationType === 'group'
          ? 'Esperando a que se sumen…'
          : 'Reconectando…'
        : formatDuration(elapsed);

  return (
    <div className="call-screen" role="dialog" aria-modal="true" aria-label={`Llamada con ${title}`}>
      <header className="call-head">
        <strong>{title}</strong>
        <small aria-live="polite">{status}</small>
        {session.encrypted && <small className="call-e2ee">🔒 Cifrada de extremo a extremo</small>}
      </header>

      <div className="call-grid" data-count={Math.max(1, remotes.length)}>
        {remotes.length === 0 ? (
          <div className="call-waiting">
            {call.participants
              .filter((participant) => participant.user.id !== user?.id)
              .slice(0, 4)
              .map((participant) => (
                <Avatar key={participant.user.id} user={participant.user} size={88} />
              ))}
          </div>
        ) : (
          remotes.map((participant) => (
            <ParticipantTile
              key={participant.identity}
              participant={participant}
              user={profiles.get(participant.identity) ?? { tag: participant.identity, displayName: participant.name || 'Participante', avatarUrl: null }}
              revision={revision}
            />
          ))
        )}
      </div>

      {user && (
        <div className="call-self">
          <ParticipantTile participant={local} user={user} isLocal revision={revision} />
        </div>
      )}

      {audioBlocked && (
        <button className="btn btn-primary call-audio-unlock" onClick={() => void resumeAudio()}>
          Tocá para escuchar la llamada
        </button>
      )}

      <footer className="call-controls">
        <button className="call-btn" data-off={!local.isMicrophoneEnabled} onClick={() => void toggleMicrophone()} aria-label={local.isMicrophoneEnabled ? 'Silenciar micrófono' : 'Activar micrófono'} aria-pressed={!local.isMicrophoneEnabled}>
          {local.isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
        </button>
        {call.kind === 'video' && (
          <>
            <button className="call-btn" data-off={!local.isCameraEnabled} onClick={() => void toggleCamera()} aria-label={local.isCameraEnabled ? 'Apagar cámara' : 'Encender cámara'} aria-pressed={!local.isCameraEnabled}>
              {local.isCameraEnabled ? <VideoIcon /> : <VideoOffIcon />}
            </button>
            <button className="call-btn" onClick={() => void switchCamera()} disabled={!local.isCameraEnabled} aria-label="Cambiar de cámara">
              <SwitchCameraIcon />
            </button>
          </>
        )}
        <button className="call-btn call-btn-danger" onClick={() => void hangUp()} aria-label="Cortar">
          <PhoneOffIcon />
        </button>
      </footer>
    </div>
  );
}

/** Milisegundos desde que se atendió (se actualiza cada segundo). */
function useElapsed(since: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, now - new Date(since).getTime()) : 0;
}

/**
 * Timbre generado con Web Audio (sin archivos de sonido). Si el navegador bloquea el audio
 * hasta que la persona toque la página, simplemente no suena: la tarjeta igual aparece.
 */
function useRingtone(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('AudioContext' in window)) return;
    const context = new AudioContext();
    const ring = () => {
      if (context.state !== 'running') return;
      const now = context.currentTime;
      for (const [offset, frequency] of [
        [0, 880],
        [0.18, 660],
        [0.6, 880],
        [0.78, 660],
      ] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.17);
      }
    };
    void context.resume().then(ring).catch(() => undefined);
    const timer = setInterval(ring, 2500);
    if ('vibrate' in navigator) navigator.vibrate([400, 200, 400]);
    return () => {
      clearInterval(timer);
      void context.close();
      if ('vibrate' in navigator) navigator.vibrate(0);
    };
  }, [enabled]);
}
