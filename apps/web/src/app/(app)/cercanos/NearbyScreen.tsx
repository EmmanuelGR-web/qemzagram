'use client';

import {
  NEARBY_DISTANCE_LABELS,
  NEARBY_DISTANCES,
  NEARBY_VISIBLE_MINUTES,
  type ContactDto,
  type ConversationDto,
  type NearbyGreetResultDto,
  type NearbyGreetingsDto,
  type NearbyPersonDto,
  type NearbyStatusDto,
  type NearbyUserDto,
} from '@qemzagram/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { LockIcon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';
import { BLOCK_EXPLANATION, blockUser } from '@/lib/blocks';
import { hideMe, LocationError, showMe } from '@/lib/nearby';
import { useRealtimeEvent } from '@/lib/realtime-context';

const asAvatar = (user: NearbyUserDto) => ({ tag: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl });

function untilLabel(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function NearbyScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<NearbyStatusDto | null>(null);
  const [people, setPeople] = useState<NearbyPersonDto[]>([]);
  const [greetings, setGreetings] = useState<NearbyGreetingsDto>({ received: [], sent: [] });
  const [consentOpen, setConsentOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [blocking, setBlocking] = useState<NearbyUserDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const current = await api<NearbyStatusDto>('/nearby/me');
    setStatus(current);
    setGreetings(await api<NearbyGreetingsDto>('/nearby/greetings'));
    setPeople(current.visible ? await api<NearbyPersonDto[]>('/nearby') : []);
  }, []);

  useEffect(() => {
    reload().catch((caught: unknown) => setError(errorMessage(caught)));
  }, [reload]);

  // Mientras soy visible, la lista se actualiza sola cada minuto (y se apaga al vencer).
  useEffect(() => {
    if (!status?.visible) return;
    const timer = setInterval(() => void reload().catch(() => undefined), 60_000);
    return () => clearInterval(timer);
  }, [status?.visible, reload]);

  useRealtimeEvent('nearby:greeting', (greeting) => {
    setNotice(`${greeting.user.displayName} te saludó.`);
    void reload().catch(() => undefined);
  });
  useRealtimeEvent('nearby:connected', (contact: ContactDto) => {
    setNotice(`¡${contact.user.displayName} aceptó tu saludo! Ya está en tu agenda.`);
    void reload().catch(() => undefined);
  });

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof LocationError ? caught.message : errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const activate = () =>
    run(async () => {
      setStatus(await showMe());
      setConsentOpen(false);
      await reload();
    });

  const hide = () =>
    run(async () => {
      await hideMe();
      await reload();
      setNotice('Ya no aparecés en "Personas cercanas" y borramos tu zona.');
    });

  const greet = (person: NearbyPersonDto) =>
    run(async () => {
      const result = await api<NearbyGreetResultDto>('/nearby/greetings', { body: { userId: person.user.id } });
      setNotice(result.state === 'connected' ? `¡Se conectaron con ${person.user.displayName}! Ya está en tu agenda.` : `Saludaste a ${person.user.displayName}.`);
      await reload();
    });

  const answer = (greetingId: string, accept: boolean) =>
    run(async () => {
      if (accept) {
        const contact = await api<ContactDto>(`/nearby/greetings/${greetingId}/accept`, { method: 'POST' });
        setNotice(`¡Listo! ${contact.user.displayName} (@${contact.user.tag}) ya está en tu agenda.`);
      } else {
        await api(`/nearby/greetings/${greetingId}/decline`, { method: 'POST' });
      }
      await reload();
    });

  const chat = (tag: string) =>
    run(async () => {
      const conversation = await api<ConversationDto>('/chats/direct', { body: { tag } });
      router.push(`/chats/${conversation.id}`);
    });

  const confirmBlock = () =>
    run(async () => {
      if (!blocking) return;
      await blockUser(blocking.id);
      setNotice(`Bloqueaste a ${blocking.displayName}.`);
      setBlocking(null);
      await reload();
    });

  if (!status) {
    return <div className="page muted">{error ? <p className="alert alert-error">{error}</p> : 'Cargando…'}</div>;
  }

  return (
    <div className="page">
      <h1>Personas cercanas</h1>
      <p className="muted">Conocé gente de tu zona. Solo te ven si vos también estás visible, y nunca ven tu ubicación exacta.</p>

      <section className="card nearby-visibility" data-visible={status.visible}>
        <div>
          <strong>{status.visible ? `Estás visible hasta las ${untilLabel(status.visibleUntil)}` : 'Estás invisible'}</strong>
          <small>
            {status.visible
              ? `Te ven con una distancia aproximada (por ejemplo "a menos de 2 km"). Se apaga sola. Cambios de zona que te quedan hoy: ${status.changesLeft}.`
              : 'Nadie te ve y no guardamos ninguna ubicación tuya.'}
          </small>
        </div>
        <div className="status-actions">
          {status.visible ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => void activate()} disabled={busy}>
                Renovar 1 h
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => void hide()} disabled={busy}>
                Volverme invisible
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setConsentOpen(true)} disabled={busy}>
              Hacerme visible
            </button>
          )}
        </div>
      </section>

      {notice && <p className="alert alert-ok">{notice}</p>}
      {error && <p className="alert alert-error">{error}</p>}

      {greetings.received.length > 0 && (
        <>
          <h3 className="section-title">Te saludaron</h3>
          <ul className="contact-list">
            {greetings.received.map((greeting) => (
              <li key={greeting.id} className="contact-row">
                <span className="contact-link">
                  <Avatar user={asAvatar(greeting.user)} size={48} />
                  <span>
                    <strong>{greeting.user.displayName}</strong>
                    <small>Si aceptás, se agregan a la agenda del otro.</small>
                  </span>
                </span>
                <div className="contact-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => void answer(greeting.id, true)} disabled={busy}>
                    Aceptar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void answer(greeting.id, false)} disabled={busy}>
                    Rechazar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setBlocking(greeting.user)} disabled={busy}>
                    Bloquear
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {status.visible &&
        NEARBY_DISTANCES.map((distance) => {
          const group = people.filter((person) => person.distance === distance);
          if (group.length === 0) return null;
          return (
            <div key={distance}>
              <h3 className="section-title">{NEARBY_DISTANCE_LABELS[distance]}</h3>
              <ul className="contact-list">
                {group.map((person) => (
                  <li key={person.user.id} className="contact-row">
                    <span className="contact-link">
                      <Avatar user={asAvatar(person.user)} size={48} />
                      <span>
                        <strong>{person.user.displayName}</strong>
                        <small>{person.tag ? `@${person.tag} · en tu agenda` : NEARBY_DISTANCE_LABELS[person.distance]}</small>
                      </span>
                    </span>
                    <div className="contact-actions">
                      {person.greeting === 'none' && (
                        <button className="btn btn-primary btn-sm" onClick={() => void greet(person)} disabled={busy}>
                          Saludar
                        </button>
                      )}
                      {person.greeting === 'sent' && (
                        <button className="btn btn-ghost btn-sm" disabled>
                          Saludo enviado
                        </button>
                      )}
                      {person.greeting === 'received' && person.greetingId && (
                        <button className="btn btn-primary btn-sm" onClick={() => void answer(person.greetingId ?? '', true)} disabled={busy}>
                          Aceptar saludo
                        </button>
                      )}
                      {person.greeting === 'connected' && person.tag && (
                        <button className="btn btn-primary btn-sm" onClick={() => void chat(person.tag ?? '')} disabled={busy}>
                          Chatear
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setBlocking(person.user)} disabled={busy}>
                        Bloquear
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

      {status.visible && people.length === 0 && <p className="empty-card">Todavía no hay nadie visible cerca tuyo. La lista se actualiza sola.</p>}

      {greetings.sent.length > 0 && (
        <>
          <h3 className="section-title">Saludos enviados</h3>
          <p className="muted small">Si no te responden en 24 horas, el saludo vence.</p>
          <ul className="contact-list">
            {greetings.sent.map((greeting) => (
              <li key={greeting.id} className="contact-row">
                <span className="contact-link">
                  <Avatar user={asAvatar(greeting.user)} size={40} />
                  <span>
                    <strong>{greeting.user.displayName}</strong>
                    <small>Esperando respuesta</small>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {consentOpen && (
        <Modal title="Antes de hacerte visible" onClose={() => setConsentOpen(false)}>
          <ul className="nearby-consent">
            <li>
              <LockIcon /> Tu ubicación exacta <strong>nunca sale de tu teléfono</strong>: solo enviamos una zona de ~1 km.
            </li>
            <li>Los demás ven tu nombre visible y tu foto, y una distancia aproximada (por ejemplo &quot;entre 2 y 5 km&quot;). Tu tag recién lo ven si aceptás su saludo.</li>
            <li>Se apaga sola en {NEARBY_VISIBLE_MINUTES} minutos, y podés volverte invisible cuando quieras (borramos tu zona).</li>
            <li>No compartas datos personales con desconocidos y, ante cualquier problema, bloqueá a la persona.</li>
          </ul>
          <label className="checkbox">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>Entiendo y quiero aparecer en &quot;Personas cercanas&quot;.</span>
          </label>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConsentOpen(false)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => void activate()} disabled={!consent || busy}>
              {busy ? 'Obteniendo tu zona…' : 'Hacerme visible'}
            </button>
          </div>
        </Modal>
      )}

      {blocking && (
        <Modal title={`¿Bloquear a ${blocking.displayName}?`} onClose={() => setBlocking(null)}>
          <p>{BLOCK_EXPLANATION}</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setBlocking(null)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={() => void confirmBlock()} disabled={busy}>
              Bloquear
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

