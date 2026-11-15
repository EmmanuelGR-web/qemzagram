'use client';

import { openCallKey, sealCallKey, type CallDto, type CallJoinDto, type CallKind, type ConversationKeysDto, type StartCallInput } from '@qemzagram/shared';
import { ExternalE2EEKeyProvider, isE2EESupported, Room, RoomEvent, Track, type LocalVideoTrack } from 'livekit-client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage, UserFacingError } from './api';
import { useAuth } from './auth-context';
import { useE2ee } from './e2ee-context';
import { e2eeLockedError } from './e2ee-messages';
import { useRealtimeEvent } from './realtime-context';

/** Si en una llamada 1 a 1 la otra persona se cae y no vuelve en este tiempo, se corta. */
const PEER_LOST_MS = 15_000;

export interface ActiveCall {
  call: CallDto;
  room: Room;
  /** Cifrada de extremo a extremo: el servidor de medios solo ve audio y video cifrados. */
  encrypted: boolean;
  /** Worker que cifra y descifra cada cuadro (se apaga al cortar). */
  worker: Worker | null;
}

const UNSUPPORTED = 'Tu navegador no admite llamadas cifradas de extremo a extremo. Probá con Chrome, Edge, Firefox o Safari actualizados.';

interface CallState {
  /** Llamada entrante que todavía no atendiste ni rechazaste. */
  incoming: CallDto | null;
  /** Llamada en la que estás (conectada a la sala de medios). */
  active: ActiveCall | null;
  /** Llamadas en curso en tus chats (para mostrar "Unirme" en los grupos). */
  openCalls: CallDto[];
  /** Cambia cada vez que pasa algo en la sala (para que la pantalla se vuelva a dibujar). */
  revision: number;
  error: string | null;
  /** El navegador bloqueó el audio hasta que la persona toque algo. */
  audioBlocked: boolean;
  start: (conversationId: string, kind: CallKind) => Promise<void>;
  accept: (call: CallDto) => Promise<void>;
  decline: (call: CallDto) => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  resumeAudio: () => Promise<void>;
  clearError: () => void;
}

const CallContext = createContext<CallState | null>(null);

/**
 * Llamadas: la API decide quién puede entrar y entrega un token de vida corta; el audio y el video
 * viajan directo entre el navegador y el servidor de medios (LiveKit), nunca por la API.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { device, keysById } = useE2ee();
  const [incoming, setIncoming] = useState<CallDto | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [openCalls, setOpenCalls] = useState<CallDto[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const activeRef = useRef<ActiveCall | null>(null);
  const facing = useRef<'user' | 'environment'>('user');
  const busy = useRef(false);
  activeRef.current = active;

  const myId = user?.id;

  /** Agrega/actualiza una llamada en curso, o la quita si terminó. */
  const track = useCallback((call: CallDto) => {
    setOpenCalls((current) => {
      const others = current.filter((item) => item.id !== call.id);
      return call.status === 'ended' ? others : [...others, call];
    });
  }, []);
  const isInvited = useCallback((call: CallDto) => call.status === 'ringing' && call.participants.some((p) => p.user.id === myId && p.state === 'invited'), [myId]);

  /** Desconecta la sala local (sin avisar a la API). */
  const teardown = useCallback(() => {
    const current = activeRef.current;
    activeRef.current = null;
    setActive(null);
    setAudioBlocked(false);
    if (current) {
      void current.room.disconnect().finally(() => current.worker?.terminate());
    }
  }, []);

  // Al abrir la app: ¿hay una llamada sonando para mí?
  useEffect(() => {
    if (!myId) return;
    api<CallDto[]>('/calls/active')
      .then((calls) => {
        setOpenCalls(calls);
        setIncoming(calls.find(isInvited) ?? null);
      })
      .catch(() => undefined);
  }, [myId, isInvited]);

  useRealtimeEvent('call:incoming', (call) => {
    track(call);
    if (activeRef.current?.call.id === call.id) return;
    setIncoming(call);
  });

  useRealtimeEvent('call:updated', (call) => {
    track(call);
    setIncoming((current) => (current?.id === call.id && !isInvited(call) ? null : current));
    const current = activeRef.current;
    if (current?.call.id !== call.id) return;
    if (call.status === 'ended') teardown();
    else {
      const updated = { ...current, call };
      activeRef.current = updated;
      setActive(updated);
    }
  });

  /**
   * Abre la clave de una llamada cifrada con la clave de ESTE dispositivo. La clave de quien llama se busca
   * por id y tiene que ser de esa persona (si no, el servidor podría hacerse pasar por otra).
   */
  const openKey = useCallback(
    async (call: CallDto): Promise<Uint8Array | null> => {
      if (!call.e2ee) return null;
      if (!isE2EESupported()) throw new UserFacingError(UNSUPPORTED);
      if (!device) throw e2eeLockedError();
      const senderKey = (await keysById([call.e2ee.sk])).get(call.e2ee.sk);
      if (!senderKey || senderKey.userId !== call.startedBy) throw new UserFacingError('No pudimos verificar quién inició esta llamada.');
      try {
        return await openCallKey(
          call.e2ee,
          { conversationId: call.conversationId, objectId: call.id, senderId: call.startedBy },
          { userId: device.userId, keyId: device.keyId, privateKey: device.privateKey },
          senderKey.publicKey,
        );
      } catch {
        throw new UserFacingError('No pudimos abrir la clave de esta llamada cifrada.');
      }
    },
    [device, keysById],
  );

  /** Si TODOS en el chat activaron el cifrado, la llamada nace cifrada: id y clave se generan acá. */
  const planCall = useCallback(
    async (conversationId: string, kind: CallKind): Promise<{ body: StartCallInput; key: Uint8Array | null }> => {
      const keys = await api<ConversationKeysDto>(`/e2ee/conversations/${conversationId}/keys`);
      if (!keys.members.every((member) => member.key)) return { body: { kind }, key: null };
      const mine = keys.members.find((member) => member.userId === device?.userId);
      if (!device || mine?.key?.id !== device.keyId) throw e2eeLockedError();
      if (!isE2EESupported()) throw new UserFacingError(UNSUPPORTED);
      const id = crypto.randomUUID();
      const recipients = keys.members.flatMap((member) => (member.key ? [{ userId: member.userId, keyId: member.key.id, publicJwk: member.key.publicKey }] : []));
      const sealed = await sealCallKey({ conversationId, objectId: id, senderId: device.userId }, device, recipients);
      return { body: { kind, e2ee: { id, envelope: sealed.envelope } }, key: sealed.key };
    },
    [device],
  );

  /** Conecta a la sala con el token recibido y enciende micrófono (y cámara en videollamadas). */
  const connect = useCallback(
    async (join: CallJoinDto, callKey: Uint8Array | null) => {
      let worker: Worker | null = null;
      let keyProvider: ExternalE2EEKeyProvider | null = null;
      if (callKey) {
        // Cifrado de extremo a extremo de LiveKit: cada cuadro de audio y video se cifra en un worker con la clave de la llamada.
        keyProvider = new ExternalE2EEKeyProvider();
        await keyProvider.setKey(new Uint8Array(callKey).buffer);
        worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url));
      }
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        stopLocalTrackOnUnpublish: true,
        ...(keyProvider && worker ? { encryption: { keyProvider, worker } } : {}),
      });
      if (keyProvider) await room.setE2EEEnabled(true);
      const refresh = () => setRevision((value) => value + 1);
      let peerLostTimer: ReturnType<typeof setTimeout> | null = null;

      room
        .on(RoomEvent.ParticipantConnected, () => {
          if (peerLostTimer) clearTimeout(peerLostTimer);
          refresh();
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          refresh();
          // En un 1 a 1, si la otra persona se cae (cerró la pestaña, se quedó sin red) y no vuelve, se corta.
          if (join.call.conversationType === 'direct' && room.remoteParticipants.size === 0) {
            peerLostTimer = setTimeout(() => void leaveCall(), PEER_LOST_MS);
          }
        })
        .on(RoomEvent.TrackSubscribed, refresh)
        .on(RoomEvent.TrackUnsubscribed, refresh)
        .on(RoomEvent.TrackMuted, refresh)
        .on(RoomEvent.TrackUnmuted, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.LocalTrackUnpublished, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
        .on(RoomEvent.MediaDevicesError, () => setError('No pudimos usar el micrófono o la cámara. Revisá los permisos del navegador.'))
        .on(RoomEvent.EncryptionError, () => setError('Hubo un problema con el cifrado de la llamada. Si no se escucha, cortá y volvé a llamar.'))
        .on(RoomEvent.Disconnected, () => {
          if (peerLostTimer) clearTimeout(peerLostTimer);
          // Se cortó la conexión con el servidor de medios: se avisa a la API que salimos.
          if (activeRef.current?.room === room) void leaveCall();
        });

      track(join.call);
      const session: ActiveCall = { call: join.call, room, encrypted: Boolean(callKey), worker };
      activeRef.current = session;
      setActive(session);
      try {
        await room.connect(join.url, join.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (join.call.kind === 'video') await room.localParticipant.setCameraEnabled(true, { facingMode: facing.current });
        setAudioBlocked(!room.canPlaybackAudio);
        refresh();
      } catch (caught) {
        setError(caught instanceof Error && /permission|NotAllowed/i.test(caught.message) ? 'Necesitamos permiso para usar el micrófono (y la cámara en videollamadas).' : 'No pudimos conectar la llamada.');
        await leaveCall();
      }
    },
    // leaveCall se declara abajo; se usa a través de la referencia estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const leaveCall = useCallback(async () => {
    const current = activeRef.current;
    teardown();
    if (current) await api(`/calls/${current.call.id}/leave`, { method: 'POST' }).catch(() => undefined);
  }, [teardown]);

  const guard = useCallback(async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      busy.current = false;
    }
  }, []);

  const start = useCallback(
    (conversationId: string, kind: CallKind) =>
      guard(async () => {
        if (activeRef.current) throw new Error('Ya estás en una llamada');
        const planned = await planCall(conversationId, kind);
        await connect(await api<CallJoinDto>(`/chats/${conversationId}/calls`, { body: planned.body }), planned.key);
      }),
    [guard, connect, planCall],
  );

  const accept = useCallback(
    (call: CallDto) =>
      guard(async () => {
        // La clave se abre ANTES de atender: si este dispositivo no puede, ni siquiera se entra a la sala.
        const callKey = await openKey(call);
        if (activeRef.current) await leaveCall(); // atender otra llamada corta la actual
        setIncoming(null);
        await connect(await api<CallJoinDto>(`/calls/${call.id}/join`, { method: 'POST' }), callKey);
      }),
    [guard, connect, leaveCall, openKey],
  );

  const decline = useCallback(
    (call: CallDto) =>
      guard(async () => {
        setIncoming(null);
        await api(`/calls/${call.id}/decline`, { method: 'POST' });
      }),
    [guard],
  );

  const value = useMemo<CallState>(
    () => ({
      incoming,
      active,
      openCalls,
      revision,
      error,
      audioBlocked,
      start,
      accept,
      decline,
      hangUp: leaveCall,
      toggleMicrophone: async () => {
        const room = activeRef.current?.room;
        if (room) await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
      },
      toggleCamera: async () => {
        const room = activeRef.current?.room;
        if (room) await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled, { facingMode: facing.current });
      },
      switchCamera: async () => {
        const track = activeRef.current?.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
        if (!track) return;
        facing.current = facing.current === 'user' ? 'environment' : 'user';
        await track.restartTrack({ facingMode: facing.current });
      },
      resumeAudio: async () => {
        await activeRef.current?.room.startAudio();
        setAudioBlocked(false);
      },
      clearError: () => setError(null),
    }),
    [incoming, active, openCalls, revision, error, audioBlocked, start, accept, decline, leaveCall],
  );

  // Al cerrar sesión o salir de la app, se corta.
  useEffect(() => () => void leaveCall(), [leaveCall]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls(): CallState {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCalls debe usarse dentro de <CallProvider>');
  return context;
}
