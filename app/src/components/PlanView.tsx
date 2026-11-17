import { fetchPlan, runAiPlan, type PlanStep, type StorePlan } from '@/lib/api'
import { cn } from 'cn'
import {
  Check,
  Copy,
  FileText,
  FolderPlus,
  ListChecks,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  X,
  ArrowRight,
  Heading,
} from 'lucide-react'
import { useEffect, useState } from 'react'

const icons: Record<string, typeof FolderPlus> = {
  note: Heading,
  mkdir: FolderPlus,
  move: ArrowRight,
  copy: Copy,
  rename: Pencil,
  delete: Trash2,
  restore: RotateCcw,
  star: Star,
  unstar: StarOff,
  write: FileText,
}

const tones: Record<string, string> = {
  note: 'bg-white/10 text-white',
  mkdir: 'bg-[#fbbc04]/15 text-[#fbbc04]',
  move: 'bg-[#8ab4f8]/15 text-[#8ab4f8]',
  copy: 'bg-[#78d9ec]/15 text-[#78d9ec]',
  rename: 'bg-[#f0c27a]/15 text-[#f0c27a]',
  delete: 'bg-[#f28b82]/15 text-[#f28b82]',
  restore: 'bg-[#81c995]/15 text-[#81c995]',
  star: 'bg-[#fdd663]/15 text-[#fdd663]',
  unstar: 'bg-white/10 text-[#c8c8c8]',
  write: 'bg-[#8ab4f8]/15 text-[#8ab4f8]',
}

function detail(step: PlanStep): string {
  if (step.op === 'move' || step.op === 'copy') return [step.from, step.to || 'Home'].filter(Boolean).join(' → ')
  if (step.op === 'rename') return [step.path, step.name].filter(Boolean).join(' → ')
  if (step.op === 'write') return step.path ?? ''
  if (step.op === 'restore') return [step.path, step.to].filter(Boolean).join(' → ')
  return step.path ?? ''
}

export function PlanView({ path, onClose }: { path: string; onClose: () => void }) {
  const [plan, setPlan] = useState<StorePlan | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancel = false
    setPlan(null)
    setError('')
    fetchPlan(path)
      .then((next) => { if (!cancel) setPlan(next) })
      .catch((err: unknown) => { if (!cancel) setError(err instanceof Error ? err.message : 'Could not open the plan') })
    return () => { cancel = true }
  }, [path])

  async function approve() {
    if (busy || plan?.status === 'done') return
    setBusy(true)
    setError('')
    try {
      setPlan(await runAiPlan(path))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan did not finish')
    } finally {
      setBusy(false)
    }
  }

  const done = plan?.status === 'done'
  const finished = plan?.steps.filter((step) => step.done).length ?? 0
  const total = plan?.steps.length ?? 0

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 md:p-10" onMouseDown={onClose}>
      <article
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-[#121212] text-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between px-8 pt-6 md:px-10">
          <span className="flex items-center gap-2 text-xs font-medium text-[#8d8d8d]">
            <ListChecks className="size-3.5" />
            Plan
          </span>
          <button type="button" className="rounded-full p-2 text-[#c8c8c8] hover:bg-white/10" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </button>
        </header>
        {plan ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 md:px-10">
              <h2 className="mt-3 max-w-xl text-[34px] font-medium leading-tight tracking-tight">{plan.title}</h2>
              {plan.summary ? <p className="mt-4 max-w-xl text-[15px] leading-7 text-[#c8c8c8]">{plan.summary}</p> : null}
              <div className="mt-6 flex items-center gap-3 text-xs text-[#8d8d8d]">
                <span>{finished} of {total} done</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full bg-[#22C55E]" style={{ width: total ? `${(finished / total) * 100}%` : '0%' }} />
                </span>
              </div>
              <ul className="mt-6 flex flex-col gap-2">
                {plan.steps.map((step, index) => {
                  const Icon = icons[step.op] ?? FileText
                  const heading = step.op === 'note'
                  return (
                    <li key={`${step.text}-${index}`} className={cn('flex gap-3 rounded-2xl px-3 py-3', heading ? 'mt-2 bg-transparent px-1' : 'bg-[#1a1a1a]')}>
                      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', tones[step.op] ?? 'bg-white/10 text-white')}>
                        {step.done && !heading ? <Check className="size-4" strokeWidth={2.4} /> : <Icon className="size-4" />}
                      </span>
                      <span className="min-w-0 pt-0.5">
                        <span className={cn('block text-[15px] leading-6', heading ? 'text-lg font-medium' : '', step.done && !heading ? 'text-[#9a9a9a] line-through' : '')}>{step.text}</span>
                        {!heading && detail(step) ? <span className="mt-0.5 block truncate text-xs text-[#8d8d8d]">{detail(step)}</span> : null}
                        {step.error ? <span className="mt-1 block text-xs text-[#f28b82]">{step.error}</span> : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-8 py-4 md:px-10">
              <p className="text-sm text-[#8d8d8d]">{done ? 'Finished' : error || 'Nothing runs until you approve this.'}</p>
              <button
                type="button"
                disabled={busy || done}
                className="h-10 rounded-full bg-white px-4 text-sm font-medium text-[#141414] disabled:opacity-40"
                onClick={() => void approve()}
              >
                {busy ? 'Working…' : done ? 'Approved' : 'Approve Plan'}
              </button>
            </footer>
          </>
        ) : (
          <p className="px-8 py-10 text-sm text-[#8d8d8d] md:px-10">{error || 'Opening the plan…'}</p>
        )}
      </article>
    </div>
  )
}
