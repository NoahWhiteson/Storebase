import { dismissOperation, useOperations } from '@/lib/operations'

export function OperationPanel() {
  const operations = useOperations()
  if (!operations.length) return null
  return <aside aria-label="File operations" className="fixed bottom-5 right-5 z-[60] w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border border-white/15 bg-[#202020] p-4 text-white shadow-2xl">
    <h2 className="mb-3 text-sm font-medium">File operations · {operations.filter(op => op.state === 'running').length} running</h2>
    <div className="max-h-72 space-y-4 overflow-y-auto">
      {operations.map(op => <div key={op.id}>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{op.label}</span>
          {op.state !== 'running' && <button aria-label={`Dismiss ${op.label}`} onClick={() => dismissOperation(op.id)} className="px-2">×</button>}
        </div>
        <p className="truncate text-xs text-white/60" title={op.detail}>{op.detail}</p>
        <div role="progressbar" aria-label={op.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={op.progress} aria-valuetext={op.state === 'running' ? op.progress == null ? 'In progress' : `${Math.round(op.progress)}%` : op.state === 'done' ? 'Complete' : 'Failed'} className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${op.state === 'error' ? 'bg-red-400' : 'bg-blue-400'} ${op.state === 'running' && op.progress == null ? 'operation-indeterminate' : ''}`} style={{ width: `${op.progress ?? 35}%` }} />
        </div>
        <p role="status" className={`mt-1 text-xs ${op.state === 'error' ? 'text-red-300' : 'text-white/60'}`}>{op.state === 'done' ? 'Complete' : op.state === 'error' ? 'Failed' : op.progress == null ? 'Working…' : `${Math.round(op.progress)}%`}</p>
      </div>)}
    </div>
  </aside>
}
