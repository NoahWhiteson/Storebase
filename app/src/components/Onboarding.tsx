import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBytes } from '@/lib/format'
import { submitSetup, type DiskInfo } from '@/lib/setup'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

type ExtraUser = {
  key: string
  name: string
  email: string
  password: string
}

const fieldClass =
  'h-12 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'

function bytesToGb(bytes: number): number {
  return bytes / 1024 ** 3
}

function gbToBytes(gb: number): number {
  return gb * 1024 ** 3
}

function prettyGb(gb: number): string {
  if (gb >= 100) return gb.toFixed(0)
  if (gb >= 10) return gb.toFixed(1)
  return gb.toFixed(1)
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

type Phase =
  | 'name'
  | 'email'
  | 'password'
  | 'confirm'
  | 'storage'
  | 'people'
  | 'user-name'
  | 'user-email'
  | 'user-password'

const order: Phase[] = ['name', 'email', 'password', 'confirm', 'storage', 'people']
const FADE_MS = 460

type Layer = { id: number; phase: Phase }

export function Onboarding({
  disk,
  onDone,
}: {
  disk: DiskInfo
  onDone: (account: { name: string; email: string; reservedBytes: number }) => void
}) {
  const maxGb = Math.max(0.1, Math.floor(bytesToGb(disk.freeBytes) * 10) / 10)
  const defaultGb = Math.min(100, Math.max(1, Math.floor(maxGb * 0.5)))
  const idRef = useRef(0)
  const paneRefs = useRef(new Map<number, HTMLDivElement>())
  const [layers, setLayers] = useState<Array<Layer & { mode: 'enter' | 'in' | 'out' }>>([
    { id: 0, phase: 'name', mode: 'in' },
  ])
  const [stageHeight, setStageHeight] = useState<number | undefined>(undefined)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reserveGb, setReserveGb] = useState(defaultGb)
  const [extras, setExtras] = useState<ExtraUser[]>([])
  const [draft, setDraft] = useState<ExtraUser>({ key: '', name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const live = layers.find((layer) => layer.mode !== 'out') ?? layers[layers.length - 1]
  const leaving = layers.find((layer) => layer.mode === 'out') ?? null
  const phase = live.phase
  const transitioning = leaving != null

  const extraPayload = useMemo(
    () =>
      extras.map((user) => ({
        name: user.name.trim(),
        email: user.email.trim(),
        password: user.password,
      })),
    [extras],
  )

  function reduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function bindPane(id: number) {
    return (el: HTMLDivElement | null) => {
      if (el) paneRefs.current.set(id, el)
      else paneRefs.current.delete(id)
    }
  }

  function go(next: Phase) {
    if (next === phase || transitioning || busy) return
    setError(null)
    if (reduceMotion()) {
      setStageHeight(undefined)
      setLayers([{ id: ++idRef.current, phase: next, mode: 'in' }])
      return
    }
    const fromEl = paneRefs.current.get(live.id)
    setStageHeight(fromEl?.offsetHeight)
    const outgoing = live
    setLayers([
      { ...outgoing, mode: 'out' },
      { id: ++idRef.current, phase: next, mode: 'enter' },
    ])
  }

  function back() {
    if (transitioning || busy) return
    if (phase === 'user-name') {
      setDraft({ key: '', name: '', email: '', password: '' })
      go('people')
      return
    }
    if (phase === 'user-email') {
      go('user-name')
      return
    }
    if (phase === 'user-password') {
      go('user-email')
      return
    }
    const i = order.indexOf(phase)
    if (i > 0) go(order[i - 1])
  }

  function advance() {
    if (transitioning || busy) return
    if (phase === 'name') {
      if (!name.trim()) return setError('Name is required')
      return go('email')
    }
    if (phase === 'email') {
      if (!email.includes('@')) return setError('Email looks wrong')
      return go('password')
    }
    if (phase === 'password') {
      if (password.length < 8) return setError('Password must be at least 8 characters')
      return go('confirm')
    }
    if (phase === 'confirm') {
      if (password !== confirm) return setError('Passwords do not match')
      return go('storage')
    }
    if (phase === 'storage') {
      if (!(reserveGb > 0) || reserveGb > maxGb) {
        return setError(`Pick between 0.1 and ${maxGb} GB`)
      }
      return go('people')
    }
    if (phase === 'user-name') {
      if (!draft.name.trim()) return setError('Name is required')
      return go('user-email')
    }
    if (phase === 'user-email') {
      if (!draft.email.includes('@')) return setError('Email looks wrong')
      return go('user-password')
    }
    if (phase === 'user-password') {
      if (draft.password.length < 8) return setError('Password must be at least 8 characters')
      setExtras((current) => [...current, { ...draft, name: draft.name.trim(), email: draft.email.trim() }])
      setDraft({ key: '', name: '', email: '', password: '' })
      return go('people')
    }
  }

  function startUser() {
    if (transitioning || busy) return
    setDraft({ key: crypto.randomUUID(), name: '', email: '', password: '' })
    go('user-name')
  }

  async function finish() {
    if (transitioning) return
    setBusy(true)
    setError(null)
    try {
      const result = await submitSetup({
        admin: { name: name.trim(), email: email.trim(), password },
        reserveGb,
        users: extraPayload,
      })
      onDone({
        name: result.admin.name,
        email: result.admin.email,
        reservedBytes: result.reservedBytes,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter' || busy || transitioning) return
    if (phase === 'people') return
    e.preventDefault()
    advance()
  }

  useLayoutEffect(() => {
    if (!layers.some((layer) => layer.mode === 'enter')) return
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setLayers((current) =>
          current.map((layer) => (layer.mode === 'enter' ? { ...layer, mode: 'in' } : layer)),
        )
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [layers])

  useLayoutEffect(() => {
    if (!leaving) return
    const incoming = paneRefs.current.get(live.id)
    if (!incoming) return
    const to = incoming.offsetHeight
    const frame = requestAnimationFrame(() => setStageHeight(to))
    return () => cancelAnimationFrame(frame)
  }, [leaving, live.id])

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => {
      setLayers((current) => current.filter((layer) => layer.mode !== 'out'))
      setStageHeight(undefined)
    }, FADE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, live.id])

  useEffect(() => {
    const root = paneRefs.current.get(live.id)
    const input = root?.querySelector<HTMLInputElement>('input:not([type="range"])')
    input?.focus()
  }, [live.id])

  function renderStep(step: Phase, active: boolean) {
    const locked = !active || busy || transitioning
    return (
      <>
        {step === 'name' ? (
          <Question title="Admin name" hint="This account owns the node.">
            <Input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="name"
            />
          </Question>
        ) : null}

        {step === 'email' ? (
          <Question title="Admin email" hint="Used to sign in as the node owner.">
            <Input
              className={fieldClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="email"
            />
          </Question>
        ) : null}

        {step === 'password' ? (
          <Question title="Admin password" hint="At least 8 characters.">
            <Input
              className={fieldClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="new-password"
            />
          </Question>
        ) : null}

        {step === 'confirm' ? (
          <Question title="Confirm password">
            <Input
              className={fieldClass}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="new-password"
            />
          </Question>
        ) : null}

        {step === 'storage' ? (
          <Question
            title="How much storage?"
            hint="Hard cap for this node. The rest of the disk stays for the OS and everything else."
          >
            <StoragePicker
              disk={disk}
              maxGb={maxGb}
              reserveGb={reserveGb}
              onChange={(gb) => setReserveGb(clamp(gb, 0.1, maxGb))}
              onEnter={onEnter}
            />
          </Question>
        ) : null}

        {step === 'people' ? (
          <Question
            title="Add other user accounts?"
            hint={
              extras.length
                ? `${extras.length} extra ${extras.length === 1 ? 'account' : 'accounts'} ready.`
                : 'Optional. You can skip this.'
            }
          >
            {extras.length ? (
              <ul className="mb-4 space-y-1 text-sm text-[#c4c7c5]">
                {extras.map((user) => (
                  <li key={user.key}>
                    {user.name} · {user.email}
                  </li>
                ))}
              </ul>
            ) : null}
          </Question>
        ) : null}

        {step === 'user-name' ? (
          <Question title="User name">
            <Input
              className={fieldClass}
              value={draft.name}
              onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
              onKeyDown={onEnter}
            />
          </Question>
        ) : null}

        {step === 'user-email' ? (
          <Question title="User email">
            <Input
              className={fieldClass}
              type="email"
              value={draft.email}
              onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
              onKeyDown={onEnter}
            />
          </Question>
        ) : null}

        {step === 'user-password' ? (
          <Question title="User password" hint="At least 8 characters.">
            <Input
              className={fieldClass}
              type="password"
              value={draft.password}
              onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))}
              onKeyDown={onEnter}
            />
          </Question>
        ) : null}

        {active && error ? <p className="mt-4 text-sm text-[#f28b82]">{error}</p> : null}

        <div className="mt-8 flex flex-wrap gap-2">
          {step !== 'name' ? (
            <Button type="button" variant="ghost" className="h-11 rounded-full" disabled={locked} onClick={back}>
              Back
            </Button>
          ) : null}

          {step === 'people' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-11 rounded-full bg-[#242424] text-white hover:bg-[#2e2e2e]"
                disabled={locked}
                onClick={startUser}
              >
                Add a user
              </Button>
              <Button
                type="button"
                className="h-11 flex-1 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
                disabled={locked}
                onClick={() => void finish()}
              >
                {busy ? 'Setting up…' : 'Finish'}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="h-11 flex-1 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
              disabled={locked}
              onClick={advance}
            >
              Continue
            </Button>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="flex min-h-full flex-col bg-[#1a1a1a] text-white">
      <header className="flex h-16 items-center gap-2.5 px-5">
        <StorebaseLogo className="size-8" />
        <span className="text-[20px] font-medium tracking-tight">Storebase</span>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 pb-16">
        <div
          className={`onboard-stage${leaving ? ' is-animating' : ''}`}
          style={stageHeight != null ? { height: stageHeight } : undefined}
        >
          {layers.map((layer) => (
            <div
              key={layer.id}
              ref={bindPane(layer.id)}
              className={`onboard-pane is-${layer.mode}`}
              aria-hidden={layer.mode === 'out'}
            >
              {renderStep(layer.phase, layer.mode !== 'out')}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

function StoragePicker({
  disk,
  maxGb,
  reserveGb,
  onChange,
  onEnter,
}: {
  disk: DiskInfo
  maxGb: number
  reserveGb: number
  onChange: (gb: number) => void
  onEnter: (e: KeyboardEvent) => void
}) {
  const [text, setText] = useState(prettyGb(reserveGb))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(prettyGb(reserveGb))
  }, [focused, reserveGb])

  const reservedBytes = gbToBytes(reserveGb)
  const leftover = Math.max(0, disk.freeBytes - reservedBytes)
  const occupied = Math.max(0, disk.totalBytes - disk.freeBytes)
  const total = Math.max(1, disk.totalBytes)
  const fillPct = maxGb > 0 ? (reserveGb / maxGb) * 100 : 0
  const step = maxGb >= 100 ? 1 : 0.1
  const tight = leftover < 2 * 1024 ** 3

  const occupiedPct = (occupied / total) * 100
  const reservedPct = (reservedBytes / total) * 100
  const leftoverPct = (leftover / total) * 100

  const presets = [
    { label: '25%', gb: clamp(Math.round(maxGb * 0.25 * 10) / 10, 0.1, maxGb) },
    { label: '50%', gb: clamp(Math.round(maxGb * 0.5 * 10) / 10, 0.1, maxGb) },
    { label: '75%', gb: clamp(Math.round(maxGb * 0.75 * 10) / 10, 0.1, maxGb) },
    { label: 'All free', gb: maxGb },
  ].filter((preset, index, list) => list.findIndex((item) => Math.abs(item.gb - preset.gb) < 0.05) === index)

  function commitText(raw: string) {
    const parsed = Number(raw.replace(/[^\d.]/g, ''))
    if (!Number.isFinite(parsed) || raw.trim() === '') {
      setText(prettyGb(reserveGb))
      return
    }
    onChange(clamp(Math.round(parsed * 10) / 10, 0.1, maxGb))
  }

  const shown = focused ? text : prettyGb(reserveGb)

  return (
    <div className="space-y-7">
      <div>
        <div className="flex items-end gap-2">
          <input
            aria-label="Reserve gigabytes"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={shown}
            onFocus={() => {
              setFocused(true)
              setText(prettyGb(reserveGb))
            }}
            onBlur={() => {
              commitText(text)
              setFocused(false)
            }}
            onChange={(e) => {
              const next = e.target.value
              setText(next)
              const parsed = Number(next)
              if (Number.isFinite(parsed) && parsed > 0) {
                onChange(clamp(Math.round(parsed * 10) / 10, 0.1, maxGb))
              }
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              commitText(text)
              onEnter(e)
            }}
            className="bg-transparent p-0 font-medium tracking-tight tabular-nums outline-none"
            style={{
              width: `${Math.max(2, shown.length)}ch`,
              fontSize: shown.length > 5 ? 56 : 72,
              lineHeight: 1,
            }}
          />
          <span className="mb-2 text-xl text-[#8d8d8d]">GB</span>
        </div>
        <p className="mt-2 text-sm text-[#8d8d8d]">
          of {formatBytes(disk.freeBytes)} free · {formatBytes(disk.totalBytes)} disk
        </p>
      </div>

      <div>
        <div className="relative flex h-7 items-center">
          <div className="pointer-events-none absolute inset-x-[11px] h-2 rounded-full bg-[#2a2a2a]">
            <div className="h-full rounded-full bg-white" style={{ width: `${fillPct}%` }} />
          </div>
          <input
            type="range"
            min={0.1}
            max={maxGb}
            step={step}
            value={reserveGb}
            aria-valuemin={0.1}
            aria-valuemax={maxGb}
            aria-valuenow={reserveGb}
            aria-label="Storage reserve"
            onChange={(e) => onChange(Number(e.target.value))}
            className="disk-slider relative z-10"
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-[#6b6b6b]">
          <span>0.1 GB</span>
          <span>{prettyGb(maxGb)} GB max</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => {
          const active = Math.abs(preset.gb - reserveGb) < (step === 1 ? 0.51 : 0.05)
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.gb)}
              className={`h-8 rounded-full px-3 text-sm ${
                active
                  ? 'bg-white text-[#1a1a1a]'
                  : 'bg-white/[0.08] text-[#e8e8e8] hover:bg-white/[0.12]'
              }`}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <div>
        <p className="mb-2 text-[11px] tracking-wide text-[#6b6b6b] uppercase">This disk</p>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[#2a2a2a]">
          {occupiedPct > 0.2 ? (
            <div className="bg-[#5a5a5a]" style={{ width: `${occupiedPct}%` }} />
          ) : null}
          <div className="bg-white" style={{ width: `${Math.max(0.6, reservedPct)}%` }} />
          {leftoverPct > 0.2 ? (
            <div className="bg-[#2f2f2f]" style={{ width: `${leftoverPct}%` }} />
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[#8d8d8d]">
              <span className="size-2 rounded-full bg-[#5a5a5a]" />
              Other
            </div>
            <div className="tabular-nums text-[#e8e8e8]">{formatBytes(occupied)}</div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[#8d8d8d]">
              <span className="size-2 rounded-full bg-white" />
              Storebase
            </div>
            <div className="tabular-nums text-[#e8e8e8]">{formatBytes(reservedBytes)}</div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[#8d8d8d]">
              <span className="size-2 rounded-full bg-[#2f2f2f] ring-1 ring-white/15" />
              Left free
            </div>
            <div className="tabular-nums text-[#e8e8e8]">{formatBytes(leftover)}</div>
          </div>
        </div>
        {tight ? (
          <p className="mt-3 text-sm text-[#e8c07d]">
            That’s almost all free space. Leave a little for the OS.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Question({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <>
      <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
      {hint ? <p className="mt-2 text-sm text-[#8d8d8d]">{hint}</p> : null}
      <div className="mt-8">{children}</div>
    </>
  )
}
