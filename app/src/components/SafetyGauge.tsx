export function SafetyGauge({ score, status, signature }: { score?: number | null; status?: string | null; signature?: string }) {
  const value = score == null ? null : Math.max(0, Math.min(100, Math.round(score)))
  const color = value == null ? '#8d8d8d' : value < 50 ? '#f28b82' : value < 85 ? '#fdd663' : '#81c995'
  const title = value == null
    ? status === 'unavailable' ? 'Virus scanner unavailable' : status === 'error' ? 'Virus check failed' : 'Not scanned'
    : status === 'infected' ? `Potential virus${signature ? `: ${signature}` : ''}` : `Safety rating: ${value}`
  return (
    <span className="relative inline-flex h-5 w-7 shrink-0 items-end justify-center" title={title} aria-label={title}>
      <svg viewBox="0 0 28 16" className="absolute inset-x-0 top-0 h-4 w-7" aria-hidden="true">
        <path d="M3 14a11 11 0 0 1 22 0" pathLength="100" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="3" strokeLinecap="round" />
        {value != null ? <path d="M3 14a11 11 0 0 1 22 0" pathLength="100" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${value} 100`} /> : null}
      </svg>
      <span className="relative text-[8px] font-semibold leading-none" style={{ color }}>{value ?? '?'}</span>
    </span>
  )
}
