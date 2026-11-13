'use client';

import type { PublicUser } from '@qemzagram/shared';
import { Track, type Participant } from 'livekit-client';
import { useEffect, useRef } from 'react';
import { Avatar } from '@/components/Avatar';
import { MicOffIcon } from '@/components/icons';

interface Props {
  participant: Participant;
  /** Perfil de la persona (la identidad en la sala es su id de usuario). */
  user: Pick<PublicUser, 'tag' | 'displayName' | 'avatarUrl'>;
  isLocal?: boolean;
  /** Fuerza a refrescar cuando cambia algo en la sala. */
  revision: number;
}

/** Recuadro de una persona: su video, o su foto si tiene la cámara apagada. */
export function ParticipantTile({ participant, user, isLocal = false, revision }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const camera = participant.getTrackPublication(Track.Source.Camera);
  const microphone = participant.getTrackPublication(Track.Source.Microphone);
  const videoTrack = camera && !camera.isMuted ? camera.track : undefined;
  const audioTrack = !isLocal && microphone && !microphone.isMuted ? microphone.track : undefined;

  useEffect(() => {
    const element = videoRef.current;
    if (!videoTrack || !element) return;
    videoTrack.attach(element);
    return () => {
      videoTrack.detach(element);
    };
  }, [videoTrack, revision]);

  // El audio propio nunca se reproduce (evita el eco).
  useEffect(() => {
    const element = audioRef.current;
    if (!audioTrack || !element) return;
    audioTrack.attach(element);
    return () => {
      audioTrack.detach(element);
    };
  }, [audioTrack, revision]);

  const micOff = !microphone || microphone.isMuted;
  return (
    <div className="call-tile" data-local={isLocal} data-speaking={participant.isSpeaking}>
      {videoTrack ? (
        <video ref={videoRef} autoPlay playsInline muted data-mirror={isLocal} />
      ) : (
        <div className="call-tile-avatar">
          <Avatar user={user} size={isLocal ? 56 : 96} />
        </div>
      )}
      {!isLocal && <audio ref={audioRef} autoPlay />}
      <span className="call-tile-name">
        {micOff && <MicOffIcon />} {isLocal ? 'Vos' : user.displayName}
      </span>
    </div>
  );
}
