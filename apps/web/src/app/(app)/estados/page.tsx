import { SparkleIcon } from '@/components/icons';

export const metadata = { title: 'Estados' };

export default function StatusPage() {
  return (
    <div className="page">
      <h1>Estados</h1>
      <div className="card center-stack">
        <div className="state-icon" aria-hidden="true">
          <SparkleIcon />
        </div>
        <h3>Muy pronto</h3>
        <p className="muted">
          Los estados (fotos, videos y textos que duran 24 horas, con control de quién los ve) llegan en la próxima fase del proyecto. La configuración de privacidad ya está preparada en Ajustes.
        </p>
      </div>
    </div>
  );
}
