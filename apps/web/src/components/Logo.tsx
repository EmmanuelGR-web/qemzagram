import type { SVGProps } from 'react';

/**
 * Isotipo de Qemzagram: contorno de burbuja de chat que forma una "Q", con un anillo interior,
 * tres puntos y la cola de la Q uniéndose al contorno.
 * - `tile`: ícono de app (fondo rojo con esquinas redondeadas). Para fondos claros.
 * - `plain`: solo el trazo blanco. Para fondos rojos u oscuros.
 */
export function LogoMark({ size = 40, variant = 'tile', ...props }: { size?: number; variant?: 'tile' | 'plain' } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Qemzagram" {...props}>
      <defs>
        <radialGradient id="qz-logo-bg" cx="25%" cy="20%" r="95%">
          <stop offset="0" stopColor="#d8213a" />
          <stop offset="0.55" stopColor="#a5102a" />
          <stop offset="1" stopColor="#5c0713" />
        </radialGradient>
        <linearGradient id="qz-logo-ink" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffe3e7" />
        </linearGradient>
      </defs>
      {variant === 'tile' && <rect width="100" height="100" rx="22" fill="url(#qz-logo-bg)" />}
      <g fill="none" stroke="url(#qz-logo-ink)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M44.5 79.6A34 34 0 1 0 31.6 75.3L22.5 88.5Z" />
        <circle cx="54" cy="46" r="16" />
        <path d="M58.5 61.6C61.5 71 70.5 73.5 78.2 65.8" />
      </g>
      <g fill="url(#qz-logo-ink)">
        <circle cx="46.5" cy="46" r="3.1" />
        <circle cx="54" cy="46" r="3.1" />
        <circle cx="61.5" cy="46" r="3.1" />
      </g>
    </svg>
  );
}

export function Logo({ size = 40, showTagline = false }: { size?: number; showTagline?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-text">
        <span className="logo-name">
          Qemza<span>gram</span>
        </span>
        {showTagline && <span className="logo-tagline">Conectá. Compartí. Disfrutá.</span>}
      </span>
    </span>
  );
}
