import { dismissOperation, useOperations, type Operation } from '@/lib/operations'
import { useState } from 'react'

const cardHeight = 116
const cardGap = 10

function OperationCard({ operation, count, expanded, active }: { operation: Operation; count?: number; expanded: boolean; active: boolean }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium">{operation.label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {count && count > 1 && !expanded ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{count}</span> : null}
          {operation.state !== 'running' && operation.state !== 'leaving' ? (
            <button aria-label={`Dismiss ${operation.label}`} tabIndex={active ? 0 : -1} onClick={() => dismissOperation(operation.id)} className="px-1">×</button>
          ) : null}
        </span>
      </div>
      <p className="truncate text-xs text-white/60" title={operation.detail}>{operation.detail}</p>
      <div
        role="progressbar"
        aria-label={operation.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={operation.progress}
        aria-valuetext={operation.state === 'running' ? operation.progress == null ? 'In progress' : `${Math.round(operation.progress)}%` : operation.state === 'done' ? 'Complete' : 'Failed'}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <div className={`h-full rounded-full ${operation.state === 'error' ? 'bg-red-400' : 'bg-blue-400'} ${operation.state === 'running' && operation.progress == null ? 'operation-indeterminate' : ''}`} style={{ width: `${operation.progress ?? 35}%` }} />
      </div>
      <p role="status" className={`mt-1 text-xs ${operation.state === 'error' ? 'text-red-300' : 'text-white/60'}`}>
        {operation.state === 'done' ? 'Complete' : operation.state === 'error' ? 'Failed' : operation.progress == null ? 'Working…' : `${Math.round(operation.progress)}%`}
      </p>
    </>
  )
}

export function OperationPanel({ enabled = true }: { enabled?: boolean }) {
  const operations = useOperations()
  const [expanded, setExpanded] = useState(false)
  if (!enabled || !operations.length) return null

  const ordered = [...operations].sort((a, b) => Number(a.state === 'running') - Number(b.state === 'running'))
  const visible = ordered.slice(-5)
  const leaving = operations.every((operation) => operation.state === 'leaving')
  const height = expanded
    ? visible.length * cardHeight + Math.max(0, visible.length - 1) * cardGap
    : cardHeight + Math.max(0, visible.length - 1) * 8

  return (
    <aside
      aria-label="File operations"
      className={`fixed right-5 bottom-5 z-[60] w-80 max-w-[calc(100vw-2.5rem)] ${leaving ? 'operation-panel-exit' : 'operation-panel-enter'}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false)
      }}
    >
      <div className="relative transition-[height] duration-300 ease-out" style={{ height }}>
        {visible.map((operation, index) => {
          const depth = visible.length - 1 - index
          const exiting = operation.state === 'leaving'
          const expandedOffset = depth * (cardHeight + cardGap)
          return (
            <div
              key={operation.id}
              className="absolute inset-x-0 bottom-0 min-h-[116px] rounded-xl border border-white/15 bg-[#202020] p-4 text-white shadow-2xl transition-[transform,opacity] duration-300 ease-out"
              style={{
                transform: `translateX(${exiting ? 'calc(100% + 2rem)' : '0'}) translateY(${-1 * (expanded ? expandedOffset : depth * 8)}px) scale(${expanded ? 1 : 1 - depth * 0.025})`,
                zIndex: index + 1,
                opacity: exiting ? 0 : 1,
              }}
              aria-hidden={!expanded && depth !== 0}
            >
              <OperationCard operation={operation} count={operations.length} expanded={expanded} active={expanded || depth === 0} />
            </div>
          )
        })}
      </div>
    </aside>
  )
}
