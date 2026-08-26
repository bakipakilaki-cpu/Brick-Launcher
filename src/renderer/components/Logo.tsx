import { motion } from 'framer-motion'

/**
 * An isometric brick: three faces of a cube in the accent colour, with the
 * classic stud grid on the top face. Drawn as pure SVG so it stays crisp at
 * any size and re-tints automatically when the accent colour changes.
 */
export function Logo({ size = 30, animated = true }: { size?: number; animated?: boolean }) {
  const Wrapper = animated ? motion.svg : 'svg'
  const wrapperProps = animated
    ? {
        initial: { rotate: -8, scale: 0.9, opacity: 0 },
        animate: { rotate: 0, scale: 1, opacity: 1 },
        transition: { type: 'spring' as const, stiffness: 240, damping: 18 }
      }
    : {}

  return (
    <Wrapper
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      style={{ display: 'block', flexShrink: 0 }}
      {...wrapperProps}
    >
      <defs>
        <linearGradient id="brick-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent-hover)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
        <linearGradient id="brick-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="brick-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.72" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.34" />
        </linearGradient>
      </defs>

      {/* top face */}
      <path d="M32 6 L58 20 L32 34 L6 20 Z" fill="url(#brick-top)" />
      {/* left face */}
      <path d="M6 20 L32 34 L32 58 L6 44 Z" fill="url(#brick-left)" />
      {/* right face */}
      <path d="M58 20 L58 44 L32 58 L32 34 Z" fill="url(#brick-right)" />

      {/* studs on the top face, kept subtle so the mark reads at 16px */}
      <g fill="var(--accent-ink)" opacity="0.34">
        <ellipse cx="23" cy="17" rx="4.6" ry="2.6" />
        <ellipse cx="41" cy="17" rx="4.6" ry="2.6" />
        <ellipse cx="23" cy="26" rx="4.6" ry="2.6" />
        <ellipse cx="41" cy="26" rx="4.6" ry="2.6" />
      </g>

      {/* front edge highlight */}
      <path
        d="M6 20 L32 34 L58 20"
        stroke="var(--accent-hover)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.5"
        fill="none"
      />
    </Wrapper>
  )
}

/** Full lockup used in the sidebar and the onboarding header. */
export function LogoLockup({ size = 30, sub = 'Launcher' }: { size?: number; sub?: string }) {
  return (
    <>
      <Logo size={size} />
      <div>
        <div className="sidebar-brand-name">Brick</div>
        <div className="sidebar-brand-sub">{sub}</div>
      </div>
    </>
  )
}
