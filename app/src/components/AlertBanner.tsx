import { X } from 'lucide-react'
import type { SystemAlert } from '@/lib/api'

export function AlertBanner({ alert, onClose }: { alert: SystemAlert; onClose: () => void }) {
  const danger = alert.tone === 'danger'
  return (
    <div
      role="alert"
      className={
        danger
          ? 'flex shrink-0 items-center gap-3 border-b border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100'
          : 'flex shrink-0 items-center gap-3 border-b border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100'
      }
    >
      <span className="min-w-0 flex-1 text-center">{alert.message}</span>
      <button
        type="button"
        aria-label="Dismiss alert"
        className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
