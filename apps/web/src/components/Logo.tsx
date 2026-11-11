import type { SVGProps } from 'react';

export const BRAND_RED = '#C8102E';

/**
 * Trazado del isotipo oficial (medido sobre el logotipo original de 1600×1600 px).
 * Burbuja de chat que forma una "Q": anillo exterior con colita, anillo interior con tres puntos
 * y la cola de la Q que se une al anillo exterior.
 */
function MarkShapes({ color }: { color: string }) {
  return (
    <>
      <g fill="none" stroke={color} strokeWidth="90" strokeLinecap="round" strokeLinejoin="round">
        <path d="M617 1200A528 528 0 1 0 392.9 1042.1L512 1440Z" />
        <circle cx="800" cy="704" r="288" />
        <path d="M784 880C890 880 1030 925 1110 1080" />
      </g>
      <g fill={color}>
        <circle cx="624" cy="688" r="48" />
        <circle cx="800" cy="688" r="48" />
        <circle cx="976" cy="688" r="48" />
      </g>
    </>
  );
}

/**
 * Isotipo de Qemzagram.
 * - `color`: Q roja sin fondo (fondos claros).
 * - `white`: Q blanca sin fondo (fondos rojos u oscuros).
 * - `tile`: ícono de app (Q blanca sobre cuadrado rojo redondeado).
 */
export function LogoMark({ size = 40, variant = 'color', ...props }: { size?: number; variant?: 'color' | 'white' | 'tile' } & SVGProps<SVGSVGElement>) {
  if (variant === 'tile') {
    return (
      <svg width={size} height={size} viewBox="0 0 1600 1600" role="img" aria-label="Qemzagram" {...props}>
        <rect width="1600" height="1600" rx="360" fill={BRAND_RED} />
        <g transform="translate(800 800) scale(0.86) translate(-798.5 -808)">
          <MarkShapes color="#FFFFFF" />
        </g>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="88.5 98 1420 1420" role="img" aria-label="Qemzagram" {...props}>
      <MarkShapes color={variant === 'white' ? '#FFFFFF' : BRAND_RED} />
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
