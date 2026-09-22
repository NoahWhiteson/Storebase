import { dismissOperation, useOperations } from '@/lib/operations'

export function OperationPanel({ enabled = true }: { enabled?: boolean }) {
  const operations = useOperations()
  if (!enabled || !operations.length) return null
  const ordered = [...operations].sort((a, b) => Number(a.state === 'running') - Number(b.state === 'running'))
  const visible = ordered.slice(-3)
  const front = visible[visible.length - 1]
  const leaving = operations.every((op) => op.state === 'leaving')
  return <aside aria-label="File operations" className={`fixed bottom-5 right-5 z-[60] w-80 max-w-[calc(100vw-2.5rem)] ${leaving ? 'operation-panel-exit' : 'operation-panel-enter'}`}>
    <div className="relative" style={{ height: 116 + Math.max(0, visible.length - 1) * 8 }}>
{visible.map((op, index) => {
        const depth = visible.length - 1 - index
        const isFront = op.id === front.id
        const leaving = op.state === 'leaving'
        return <div
          key={op.id}
          className="absolute inset-x-0 bottom-0 min-h-[116px] rounded-xl border border-white/15 bg-[#202020] p-4 text-white shadow-2xl transition-all duration-300"
          style={{ transform: `translateX(${leaving ? 'calc(100% + 2rem)' : '0'}) translateY(${-depth * 8}px) scale(${1 - depth * 0.025})`, zIndex: index + 1, opacity: leaving ? 0 : 1 }}
          aria-hidden={!isFront}
        >
        {isFront ? <>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">{op.label}</span>
          <span className="flex items-center gap-2">
            {operations.length > 1 ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{operations.length}</span> : null}
            {op.state !== 'running' && op.state !== 'leaving' ? <button aria-label={`Dismiss ${op.label}`} onClick={() => dismissOperation(op.id)} className="px-1">×</button> : null}
          </span>
        </div>
        <p className="truncate text-xs text-white/60" title={op.detail}>{op.detail}</p>
        <div role="progressbar" aria-label={op.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={op.progress} aria-valuetext={op.state === 'running' ? op.progress == null ? 'In progress' : `${Math.round(op.progress)}%` : op.state === 'done' ? 'Complete' : 'Failed'} className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${op.state === 'error' ? 'bg-red-400' : 'bg-blue-400'} ${op.state === 'running' && op.progress == null ? 'operation-indeterminate' : ''}`} style={{ width: `${op.progress ?? 35}%` }} />
        </div>
        <p role="status" className={`mt-1 text-xs ${op.state === 'error' ? 'text-red-300' : 'text-white/60'}`}>{op.state === 'done' ? 'Complete' : op.state === 'error' ? 'Failed' : op.progress == null ? 'Working…' : `${Math.round(op.progress)}%`}</p>
        </> : null}
      </div>})}
    </div>
  </aside>
}
