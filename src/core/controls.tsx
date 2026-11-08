import type { ReactNode } from 'react'

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  hint?: ReactNode
  onChange: (value: number) => void
}) {
  return (
    <label className="block w-full max-w-xs">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted tabular-nums">
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-fg"
      />
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  scroll,
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (value: T) => void
  scroll?: boolean // one line, scrolls sideways when it does not fit
}) {
  return (
    <div
      className={`inline-flex gap-1 rounded-xl border border-line bg-bg/80 p-1 backdrop-blur ${
        scroll ? 'max-w-full min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'max-w-full flex-wrap'
      }`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${scroll ? 'shrink-0 whitespace-nowrap' : ''} ${
            value === o.value ? 'bg-fg text-bg' : 'hover:bg-subtle'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  fill,
  compact,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
  fill?: boolean
  compact?: boolean // shorter and tighter, for packing several into a phone sheet
}) {
  return (
    <div className={`relative min-w-0 flex-1 ${fill ? 'w-full' : 'max-w-[60%]'}`}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}
        className={`w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-bg/80 font-medium ${compact ? 'h-9 py-1 pl-2.5 pr-6 text-xs' : 'h-11 py-2 pl-3 pr-9 text-sm'} shadow-sm transition hover:border-fg focus:border-fg focus:outline-none`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 12 12" aria-hidden className={`pointer-events-none absolute top-1/2 h-3 w-3 ${compact ? 'right-2' : 'right-3'} -translate-y-1/2 text-muted`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 4.5 6 8l3.5-3.5" />
      </svg>
    </div>
  )
}

export function Stepper({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number
  min: number
  max: number
  label: string
  onChange: (value: number) => void
}) {
  const btn =
    'h-9 w-9 rounded-lg text-lg leading-none transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-30'
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-bg/80 p-1 backdrop-blur">
      <button className={btn} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Remove ${label}`}>
        −
      </button>
      <span className="min-w-24 text-center font-mono text-sm tabular-nums">
        {value} {label}
        {value === 1 ? '' : 's'}
      </span>
      <button className={btn} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`Add ${label}`}>
        +
      </button>
    </div>
  )
}
