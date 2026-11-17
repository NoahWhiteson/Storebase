import { fetchPlan, runAiPlan, type StorePlan } from '@/lib/api'
import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'

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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 md:p-8" onMouseDown={onClose}>
      <article
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[#141414] text-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between px-8 pt-6">
          <p className="text-xs font-medium tracking-wide text-[#8d8d8d]">Plan</p>
          <button type="button" className="rounded-full p-2 text-[#c8c8c8] hover:bg-white/10" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </button>
        </header>
        {plan ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
              <h2 className="mt-2 text-[32px] font-medium tracking-tight">{plan.title}</h2>
              {plan.summary ? <p className="mt-3 max-w-xl text-[15px] leading-7 text-[#c8c8c8]">{plan.summary}</p> : null}
              <ul className="mt-8 flex flex-col">
                {plan.steps.map((step, index) => (
                  <li key={`${step.text}-${index}`} className="flex gap-3 border-t border-white/10 py-3">
                    <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${step.done ? 'border-[#22C55E] bg-[#22C55E] text-[#141414]' : 'border-white/20'}`}>
                      {step.done ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[15px] leading-6 ${step.done ? 'text-[#9a9a9a] line-through' : ''}`}>{step.text}</span>
                      {step.error ? <span className="mt-1 block text-xs text-[#f28b82]">{step.error}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-8 py-4">
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
          <p className="px-8 py-10 text-sm text-[#8d8d8d]">{error || 'Opening the plan…'}</p>
        )}
      </article>
    </div>
  )
}
