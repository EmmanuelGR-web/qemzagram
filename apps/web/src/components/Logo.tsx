import type { SVGProps } from 'react';

/** Isotipo de Qemzagram: burbuja de chat en forma de "Q" con tres puntos. */
export function LogoMark({ size = 40, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Qemzagram" {...props}>
      <defs>
        <linearGradient id="qz-g" x1="8" y1="6" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FF5468" />
          <stop offset="0.55" stopColor="#D91E36" />
          <stop offset="1" stopColor="#8F0E20" />
        </linearGradient>
      </defs>
      <path
        d="M32 4C16.5 4 4 15.8 4 30.4c0 7.6 3.5 14.5 9.1 19.2L11 60l11.6-5.4c2.9.9 6 1.4 9.4 1.4 15.5 0 28-11.8 28-26.4S47.500 4 32 4Z"
        fill="url(#qz-g)"
      />
      <path d="M40 41.500 54 58l-18-5.200Z" fill="#8F0E20" />
      <circle cx="21" cy="30" r="3.600" fill="#fff" />
      <circle cx="32" cy="30" r="3.600" fill="#fff" />
      <circle cx="43" cy="30" r="3.600" fill="#fff" />
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
