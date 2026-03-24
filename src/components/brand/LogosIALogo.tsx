/**
 * LogosIA Brand Logo — SVG component
 * Neural network icon + LOGOSIA gradient text
 * Works on both light and dark backgrounds (no white container needed)
 */

interface LogosIALogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  iconOnly?: boolean;
}

const sizes = {
  xs: { icon: 24, text: 0, gap: 0 },
  sm: { icon: 32, text: 12, gap: 6 },
  md: { icon: 40, text: 16, gap: 8 },
  lg: { icon: 56, text: 22, gap: 10 },
  xl: { icon: 72, text: 28, gap: 12 },
};

export function LogosIALogo({ size = 'md', showText = false, className = '', iconOnly = false }: LogosIALogoProps) {
  const s = sizes[size];

  return (
    <div className={`flex items-center ${showText ? `gap-${Math.round(s.gap / 4)}` : ''} ${className}`} style={showText ? { gap: s.gap } : undefined}>
      {/* Neural Network Icon */}
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={`logo-grad-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1A237E" />
            <stop offset="50%" stopColor="#5C6BC0" />
            <stop offset="100%" stopColor="#DAA520" />
          </linearGradient>
          <linearGradient id={`node-grad-blue-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1A237E" />
            <stop offset="100%" stopColor="#3949AB" />
          </linearGradient>
          <linearGradient id={`node-grad-gold-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#DAA520" />
            <stop offset="100%" stopColor="#FFD700" />
          </linearGradient>
          <filter id={`glow-${size}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connection lines */}
        <g stroke={`url(#logo-grad-${size})`} strokeWidth="2" opacity="0.7">
          {/* Outer connections */}
          <line x1="50" y1="15" x2="80" y2="35" />
          <line x1="80" y1="35" x2="75" y2="70" />
          <line x1="75" y1="70" x2="40" y2="80" />
          <line x1="40" y1="80" x2="20" y2="55" />
          <line x1="20" y1="55" x2="30" y2="30" />
          <line x1="30" y1="30" x2="50" y2="15" />
          {/* Inner cross connections */}
          <line x1="50" y1="15" x2="75" y2="70" />
          <line x1="50" y1="15" x2="40" y2="80" />
          <line x1="50" y1="15" x2="20" y2="55" />
          <line x1="80" y1="35" x2="40" y2="80" />
          <line x1="80" y1="35" x2="20" y2="55" />
          <line x1="75" y1="70" x2="30" y2="30" />
          {/* Center connections */}
          <line x1="50" y1="50" x2="50" y2="15" />
          <line x1="50" y1="50" x2="80" y2="35" />
          <line x1="50" y1="50" x2="75" y2="70" />
          <line x1="50" y1="50" x2="40" y2="80" />
          <line x1="50" y1="50" x2="20" y2="55" />
          <line x1="50" y1="50" x2="30" y2="30" />
        </g>

        {/* Nodes */}
        <g filter={`url(#glow-${size})`}>
          {/* Center node (largest) */}
          <circle cx="50" cy="50" r="6" fill={`url(#node-grad-blue-${size})`} />
          <circle cx="50" cy="50" r="3" fill="white" opacity="0.3" />

          {/* Outer nodes - blue side */}
          <circle cx="50" cy="15" r="5" fill={`url(#node-grad-blue-${size})`} />
          <circle cx="20" cy="55" r="4.5" fill={`url(#node-grad-blue-${size})`} />
          <circle cx="30" cy="30" r="4" fill={`url(#node-grad-blue-${size})`} />

          {/* Outer nodes - gold side */}
          <circle cx="80" cy="35" r="5" fill={`url(#node-grad-gold-${size})`} />
          <circle cx="75" cy="70" r="4.5" fill={`url(#node-grad-gold-${size})`} />
          <circle cx="40" cy="80" r="4" fill={`url(#node-grad-gold-${size})`} />

          {/* Highlight dots */}
          <circle cx="50" cy="14" r="1.5" fill="white" opacity="0.5" />
          <circle cx="79" cy="34" r="1.5" fill="white" opacity="0.4" />
        </g>
      </svg>

      {/* Text Logo */}
      {showText && !iconOnly && (
        <svg
          width={s.text * 5.5}
          height={s.text * 1.4}
          viewBox="0 0 220 50"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0"
        >
          <defs>
            <linearGradient id={`text-grad-${size}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#1A237E" />
              <stop offset="40%" stopColor="#5C6BC0" />
              <stop offset="70%" stopColor="#DAA520" />
              <stop offset="100%" stopColor="#FFD700" />
            </linearGradient>
          </defs>
          <text
            x="0"
            y="38"
            fontFamily="'Lexend', 'Inter', sans-serif"
            fontWeight="700"
            fontSize="42"
            letterSpacing="4"
            fill={`url(#text-grad-${size})`}
          >
            LOGOSIA
          </text>
        </svg>
      )}
    </div>
  );
}

/**
 * Compact icon-only version for small spaces (sidebar collapsed, favicon-like)
 */
export function LogosIAIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id="icon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1A237E" />
          <stop offset="50%" stopColor="#5C6BC0" />
          <stop offset="100%" stopColor="#DAA520" />
        </linearGradient>
        <linearGradient id="icon-blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1A237E" />
          <stop offset="100%" stopColor="#3949AB" />
        </linearGradient>
        <linearGradient id="icon-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#DAA520" />
          <stop offset="100%" stopColor="#FFD700" />
        </linearGradient>
      </defs>
      <g stroke="url(#icon-grad)" strokeWidth="2.5" opacity="0.7">
        <line x1="50" y1="15" x2="80" y2="35" />
        <line x1="80" y1="35" x2="75" y2="70" />
        <line x1="75" y1="70" x2="40" y2="80" />
        <line x1="40" y1="80" x2="20" y2="55" />
        <line x1="20" y1="55" x2="30" y2="30" />
        <line x1="30" y1="30" x2="50" y2="15" />
        <line x1="50" y1="15" x2="75" y2="70" />
        <line x1="50" y1="15" x2="20" y2="55" />
        <line x1="80" y1="35" x2="40" y2="80" />
        <line x1="80" y1="35" x2="20" y2="55" />
        <line x1="75" y1="70" x2="30" y2="30" />
        <line x1="50" y1="50" x2="50" y2="15" />
        <line x1="50" y1="50" x2="80" y2="35" />
        <line x1="50" y1="50" x2="75" y2="70" />
        <line x1="50" y1="50" x2="40" y2="80" />
        <line x1="50" y1="50" x2="20" y2="55" />
        <line x1="50" y1="50" x2="30" y2="30" />
      </g>
      <circle cx="50" cy="50" r="7" fill="url(#icon-blue)" />
      <circle cx="50" cy="50" r="3" fill="white" opacity="0.3" />
      <circle cx="50" cy="15" r="5.5" fill="url(#icon-blue)" />
      <circle cx="20" cy="55" r="5" fill="url(#icon-blue)" />
      <circle cx="30" cy="30" r="4.5" fill="url(#icon-blue)" />
      <circle cx="80" cy="35" r="5.5" fill="url(#icon-gold)" />
      <circle cx="75" cy="70" r="5" fill="url(#icon-gold)" />
      <circle cx="40" cy="80" r="4.5" fill="url(#icon-gold)" />
    </svg>
  );
}
