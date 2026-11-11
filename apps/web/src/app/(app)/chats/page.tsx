import { LogoMark } from '@/components/Logo';

export default function ChatsHomePage() {
  return (
    <div className="chat-empty">
      <LogoMark size={88} />
      <h2>Qemzagram</h2>
      <p>Elegí una conversación o creá un chat nuevo.</p>
      <p className="small muted">Tus mensajes se guardan cifrados y solo los ven los miembros de la conversación.</p>
    </div>
  );
}
