import { askAi } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'
import { ArrowUp, X } from 'lucide-react'
import { useId, useState } from 'react'

const prompts = [
  'What can you do?',
  'What kinds of questions can I ask?',
  'Help me think through a problem',
]

function Star({ className, id }: { className?: string; id: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5ec8f0" />
          <stop offset="0.48" stopColor="#f2d35a" />
          <stop offset="1" stopColor="#f07aa8" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M12 1.2c.55 4.1 2.15 6.55 6.35 8.15-4.2.55-6.55 2.15-8.15 6.35-.55-4.2-2.15-6.55-6.35-8.15C7.7 6.9 10.15 5.3 12 1.2z" />
      <path fill={`url(#${id})`} d="M18.2 2.4c.22 1.45.85 2.3 2.3 2.85-1.45.22-2.3.85-2.85 2.3-.22-1.45-.85-2.3-2.3-2.85 1.45-.55 2.08-1.4 2.85-2.3z" />
    </svg>
  )
}

export function AiStar({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  return <Star className={className} id={`ai-star-${id}`} />
}

export function AiPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const starId = useId().replace(/:/g, '')
  const first = name.trim().split(/\s+/)[0] || 'there'
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<{ role: 'you' | 'ai'; text: string }[]>([])

  async function ask(message: string) {
    const next = message.trim()
    if (!next || busy) return
    setText('')
    setTurns((current) => [...current, { role: 'you', text: next }])
    setBusy(true)
    try {
      const answer = await askAi(next)
      setTurns((current) => [...current, { role: 'ai', text: answer }])
    } catch (error) {
      setTurns((current) => [...current, { role: 'ai', text: error instanceof Error ? error.message : 'AI failed' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex h-full w-[min(100%,400px)] shrink-0 flex-col border-l border-white/10 bg-[#161616] max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:shadow-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-[15px] font-medium text-white">
          <AiStar className="size-5" />
          AI
        </div>
        <button type="button" className="rounded-full p-2 text-[#c8c8c8] hover:bg-white/10" aria-label="Close AI" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-8">
            <Star className="size-10" id={`ai-hero-${starId}`} />
            <p className="text-[22px] font-medium tracking-tight text-white">Your move, {first}</p>
            <div className="flex w-full flex-col gap-2">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2.5 text-left text-sm text-[#e8e8e8] hover:bg-white/5"
                  onClick={() => void ask(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2">
            {turns.map((turn, index) => (
              <p
                key={`${turn.role}-${index}`}
                className={cn(
                  'whitespace-pre-wrap text-sm leading-6',
                  turn.role === 'you' ? 'ml-8 rounded-2xl bg-[#242424] px-3 py-2 text-white' : 'text-[#e8e8e8]',
                )}
              >
                {turn.text}
              </p>
            ))}
            {busy ? <p className="text-sm text-[#8d8d8d]">Looking through your files…</p> : null}
          </div>
        )}
      </div>
      <form
        className="shrink-0 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(text)
        }}
      >
        <div className="flex items-center gap-2 rounded-full bg-[#242424] px-2">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Ask about your files"
            className="h-12 flex-1 border-0 bg-transparent px-3 text-[15px] shadow-none placeholder:text-[#8d8d8d] outline-none focus-visible:ring-0"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#1a1a1a] disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
    </aside>
  )
}
