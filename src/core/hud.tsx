import type { ReactNode } from 'react'

// A labelled live number, shown top-left over the scene. Turns red when bad.
export function Chip({ icon, title, value, bad }: { icon: ReactNode; title: string; value: string; bad?: boolean }) {
  return (
    <div
      aria-label={`${title}: ${value}`}
      className={`min-w-24 shrink-0 rounded-xl border bg-bg/80 px-2.5 py-1.5 backdrop-blur transition-colors sm:min-w-28 sm:px-3 sm:py-2 ${
        bad ? 'border-danger' : 'border-line'
      }`}
    >
      <div className={`chip-title flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${bad ? 'text-danger' : 'text-muted'}`}>
        {icon}
        {title}
      </div>
      <div className={`mt-0.5 whitespace-nowrap font-mono text-sm tabular-nums sm:text-base ${bad ? 'text-danger' : ''}`}>{value}</div>
    </div>
  )
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }

export function ArrowIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 8h11M9.5 4.5L13 8l-3.5 3.5" />
    </svg>
  )
}

export function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

export function StackIcon() {
  return (
    <svg {...iconProps}>
      <rect x="1.5" y="6" width="3.5" height="3.5" />
      <rect x="6.25" y="6" width="3.5" height="3.5" />
      <rect x="11" y="6" width="3.5" height="3.5" />
    </svg>
  )
}

export function InfoIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7.25V11.5" />
      <circle cx="8" cy="4.9" r="0.4" fill="currentColor" />
    </svg>
  )
}

export function CrossIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  )
}

export function GaugeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 11a6 6 0 0 1 12 0" />
      <path d="M8 11l3-3.5" />
    </svg>
  )
}

export function CoinIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M10 5.5H7a1.25 1.25 0 0 0 0 2.5h2a1.25 1.25 0 0 1 0 2.5H6M8 4v8" />
    </svg>
  )
}

export function HeartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z" />
    </svg>
  )
}
