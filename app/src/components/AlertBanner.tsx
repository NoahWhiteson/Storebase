import { AlertTriangle, CircleAlert, X } from 'lucide-react'
import type { SystemAlert } from '@/lib/api'

export function AlertBanner({ alert, onClose }: { alert: SystemAlert; onClose: () => void }) {
  const danger = alert.tone === 'danger'
  const Icon = danger ? CircleAlert : AlertTriangle
  return (
    <div
      role="alert"
      className={
        danger
          ? 'flex shrink-0 items-center gap-3 border-b border-red-400/25 bg-red-400/[0.08] px-4 py-2.5 text-sm text-red-100'
          : 'flex shrink-0 items-center gap-3 border-b border-amber-400/20 bg-amber-400/[0.08] px-4 py-2.5 text-sm text-amber-100'
      }
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-current/[0.06]">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-center leading-5">{alert.message}</span>
      <button
        type="button"
        aria-label="Dismiss alert"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-95"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
