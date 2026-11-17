import { FileGlyph } from '@/components/FileGlyph'
import { askAi, kindFromName, listFiles, type AiPlanCard, type AiProviderId, type AiRef, type AiStep } from '@/lib/api'
import type { FileKind } from '@/types'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'
import { Sparkles } from 'kubai-icons-react'
import { ArrowUp, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const prompts = [
  'What can you do?',
  'What kinds of questions can I ask?',
  'Help me think through a problem',
]

const logos: Record<AiProviderId, { title: string; hex: string; path: string }> = {
  gemini: {
    title: 'Gemini',
    hex: '#8E75B2',
    path: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  },
  claude: {
    title: 'Claude',
    hex: '#D97757',
    path: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  },
  deepseek: {
    title: 'DeepSeek',
    hex: '#4D6BFE',
    path: 'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45',
  },
  openai: {
    title: 'ChatGPT',
    hex: '#412991',
    path: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  },
}

function useSparkleLoop(): boolean {
  const [play, setPlay] = useState(false)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let cancel = false
    const timers: number[] = []
    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms))
    }
    const cycle = () => {
      if (cancel) return
      setPlay(true)
      later(() => {
        if (cancel) return
        setPlay(false)
        later(cycle, 4000)
      }, 520)
    }
    later(cycle, 700)
    return () => {
      cancel = true
      for (const id of timers) window.clearTimeout(id)
    }
  }, [])
  return play
}

export function AiStar({ size = 24 }: { size?: number }) {
  const play = useSparkleLoop()
  return <Sparkles size={size} color="#22C55E" variant="soft" trigger="none" hover={play} />
}

function ProviderMark({ provider }: { provider: AiProviderId }) {
  const logo = logos[provider]
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" role="img" aria-label={logo.title} className="shrink-0">
      <path fill={logo.hex} d={logo.path} />
    </svg>
  )
}

type Turn = { role: 'you' | 'ai'; text: string; steps?: AiStep[]; provider?: AiProviderId; plan?: AiPlanCard }
type MentionFile = { name: string; path: string; kind: FileKind }
export type AiFile = { name: string; path: string }

function tokenFor(name: string): string {
  return name.includes(' ') ? `@"${name}"` : `@${name}`
}

function StreamText({ text }: { text: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (count >= text.length) return
    const step = text.length > 500 ? 8 : 2
    const id = window.setTimeout(() => setCount((current) => Math.min(text.length, current + step)), 16)
    return () => window.clearTimeout(id)
  }, [count, text])
  return (
    <>
      {text.slice(0, count)}
      {count < text.length ? <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-px animate-pulse bg-[#22C55E]" /> : null}
    </>
  )
}

export function AiPanel({ name, files, selected, onClose, onOpenPlan }: { name: string; files: AiFile[]; selected: AiFile[]; onClose: () => void; onOpenPlan: (path: string) => void }) {
  const first = name.trim().split(/\s+/)[0] || 'there'
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [dropped, setDropped] = useState<string[]>([])
  const [home, setHome] = useState<MentionFile[]>([])
  const [inside, setInside] = useState<MentionFile[] | null>(null)
  const attached = selected.filter((file) => !dropped.includes(file.path))
  const mention = text.match(/(?:^|\s)@([^\n@]*)$/)?.[1] ?? null
  const typed = mention ?? ''
  const slash = typed.indexOf('/')
  const head = (slash >= 0 ? typed.slice(0, slash) : typed).trim()
  const tail = slash >= 0 ? typed.slice(slash + 1) : ''
  const opened = home.find((item) => item.kind === 'folder' && item.name.toLowerCase() === head.toLowerCase() && (slash >= 0 || head.length >= item.name.length))
  const pool = opened && inside ? inside : home
  const needle = opened && inside ? tail : typed
  const suggestions: MentionFile[] = mention === null ? [] : pool.filter((item) => item.name.toLowerCase().includes(needle.toLowerCase())).slice(0, 8)
  const menuLabel = opened && inside ? opened.name : 'Home'

  useEffect(() => {
    setDropped((current) => {
      const next = current.filter((path) => selected.some((file) => file.path === path))
      return next.length === current.length ? current : next
    })
  }, [selected])

  useEffect(() => {
    if (mention === null) return
    let cancel = false
    listFiles({ path: '' })
      .then((items) => {
        if (cancel) return
        setHome(items.map((item) => ({ name: item.name, path: item.path, kind: item.type === 'folder' ? 'folder' : kindFromName(item.name) })))
      })
      .catch(() => {})
    return () => { cancel = true }
  }, [mention === null])

  useEffect(() => {
    if (!opened) {
      setInside(null)
      return
    }
    setInside(null)
    let cancel = false
    listFiles({ path: opened.path })
      .then((items) => {
        if (cancel) return
        setInside(items.map((item) => ({ name: item.name, path: item.path, kind: item.type === 'folder' ? 'folder' : kindFromName(item.name) })))
      })
      .catch(() => {})
    return () => { cancel = true }
  }, [opened?.path])

  function pick(file: MentionFile) {
    if (file.kind === 'folder' && !(opened && inside)) {
      setText((current) => current.replace(/(^|\s)@[^\n@]*$/, `$1@${file.name}/`))
      return
    }
    setText((current) => current.replace(/(^|\s)@[^\n@]*$/, `$1${tokenFor(file.name)} `))
  }

  function refsFor(message: string): AiRef[] {
    const found = new Map<string, AiFile>()
    for (const file of attached) found.set(file.path, file)
    for (const file of [...files, ...home, ...(inside ?? [])]) {
      if (message.includes(tokenFor(file.name))) found.set(file.path, file)
    }
    return [...found.values()].map((file) => ({ path: file.path, name: file.name }))
  }

  async function ask(message: string) {
    const next = message.trim()
    if (!next || busy) return
    if (suggestions.length && next === text.trim()) {
      const first = suggestions[0]
      if (first) pick(first)
      return
    }
    const refs = refsFor(next)
    setText('')
    setTurns((current) => [...current, { role: 'you', text: next }])
    setBusy(true)
    try {
      const reply = await askAi(next, refs)
      setTurns((current) => [...current, { role: 'ai', text: reply.answer, steps: reply.steps, provider: reply.provider, plan: reply.plan }])
    } catch (error) {
      setTurns((current) => [...current, { role: 'ai', text: error instanceof Error ? error.message : 'AI failed' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl bg-[#161616]">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-[15px] font-medium text-white">
          <AiStar />
          AI
        </div>
        <button type="button" className="rounded-full p-2 text-[#c8c8c8] hover:bg-white/10" aria-label="Close AI" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-8">
            <AiStar size={40} />
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
          <div className="flex flex-col gap-4 pt-2">
            {turns.map((turn, index) => (
              <div key={`${turn.role}-${index}`} className="flex flex-col gap-2">
                {turn.role === 'ai' && turn.steps?.length ? (
                  <div className="flex flex-col gap-2">
                    {turn.steps.map((step, stepIndex) => (
                      <div key={`${step.command}-${stepIndex}`} className="rounded-xl bg-[#1e1e1e] px-3 py-2">
                        <p className="font-mono text-[13px] text-[#22C55E]">{step.command}</p>
                        {step.output ? <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#9a9a9a]">{step.output}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {turn.text ? (
                  <p className={cn('whitespace-pre-wrap text-sm leading-6', turn.role === 'you' ? 'ml-8 rounded-2xl bg-[#242424] px-3 py-2 text-white' : 'text-[#e8e8e8]')}>
                    {turn.role === 'ai' && index === turns.length - 1 ? <StreamText text={turn.text} /> : turn.text}
                  </p>
                ) : null}
                {turn.plan ? (
                  <button type="button" className="rounded-2xl bg-[#1e1e1e] px-3 py-3 text-left" onClick={() => onOpenPlan(turn.plan?.path ?? '')}>
                    <span className="text-[11px] text-[#8d8d8d]">Plan</span>
                    <span className="mt-1 block text-sm font-medium text-white">{turn.plan.title}</span>
                    {turn.plan.summary ? <span className="mt-1 block text-xs leading-5 text-[#9a9a9a]">{turn.plan.summary}</span> : null}
                  </button>
                ) : null}
                {turn.role === 'ai' && turn.provider ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-[#8d8d8d]">
                    <ProviderMark provider={turn.provider} />
                    {logos[turn.provider].title}
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? <p className="text-sm text-[#8d8d8d]">Opening folders…</p> : null}
          </div>
        )}
      </div>
      <form
        className="relative shrink-0 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(text)
        }}
      >
        {attached.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attached.map((file) => (
              <button
                key={file.path}
                type="button"
                className="rounded-full bg-[#242424] px-2.5 py-1 text-xs text-white"
                onClick={() => setDropped((current) => [...current, file.path])}
              >
                {file.name} ×
              </button>
            ))}
          </div>
        ) : null}
        {mention !== null ? (
          <div className="absolute right-3 bottom-full left-3 mb-1 overflow-hidden rounded-2xl bg-[#242424] py-1 shadow-xl">
            <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-[#8d8d8d]">{menuLabel}</p>
            {suggestions.length ? suggestions.map((file) => (
              <button
                key={file.path}
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/10"
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(file)
                }}
              >
                <FileGlyph kind={file.kind} name={file.name} size="sm" />
                <span className="min-w-0 truncate text-sm text-white">{file.name}</span>
              </button>
            )) : <p className="px-3 py-2 text-sm text-[#8d8d8d]">Nothing here</p>}
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-full bg-[#242424] px-2">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Ask, or @ a file"
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
