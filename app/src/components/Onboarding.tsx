import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBytes } from '@/lib/format'
import { submitSetup, type DiskInfo } from '@/lib/setup'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'

type ExtraUser = {
  key: string
  name: string
  email: string
  password: string
}

const fieldClass =
  'h-12 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] focus-visible:ring-1 focus-visible:ring-white/15'

function bytesToGb(bytes: number): number {
  return bytes / 1024 ** 3
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

export function Onboarding({
  disk,
  onDone,
}: {
  disk: DiskInfo
  onDone: (account: { name: string; email: string; reservedBytes: number }) => void
}) {
  const maxGb = Math.max(0.1, Math.floor(bytesToGb(disk.freeBytes) * 10) / 10)
  const defaultGb = Math.min(100, Math.max(1, Math.floor(maxGb * 0.5)))
  const [phase, setPhase] = useState<Phase>('name')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reserveGb, setReserveGb] = useState(defaultGb)
  const [extras, setExtras] = useState<ExtraUser[]>([])
  const [draft, setDraft] = useState<ExtraUser>({ key: '', name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const remaining = disk.freeBytes - reserveGb * 1024 ** 3
  const usedPct = maxGb > 0 ? Math.min(100, (reserveGb / maxGb) * 100) : 0

  const extraPayload = useMemo(
    () =>
      extras.map((user) => ({
        name: user.name.trim(),
        email: user.email.trim(),
        password: user.password,
      })),
    [extras],
  )

  function go(next: Phase) {
    setError(null)
    setPhase(next)
  }

  function back() {
    setError(null)
    if (phase === 'user-name') {
      setDraft({ key: '', name: '', email: '', password: '' })
      setPhase('people')
      return
    }
    if (phase === 'user-email') {
      setPhase('user-name')
      return
    }
    if (phase === 'user-password') {
      setPhase('user-email')
      return
    }
    const i = order.indexOf(phase)
    if (i > 0) setPhase(order[i - 1])
  }

  function advance() {
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
    setDraft({ key: crypto.randomUUID(), name: '', email: '', password: '' })
    go('user-name')
  }

  async function finish() {
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
    if (e.key !== 'Enter' || busy) return
    if (phase === 'people') return
    e.preventDefault()
    advance()
  }

  const showBack = phase !== 'name'

  return (
    <div className="flex min-h-full flex-col bg-[#1a1a1a] text-white">
      <header className="flex h-16 items-center gap-2.5 px-5">
        <StorebaseLogo className="size-8" />
        <span className="text-[20px] font-medium tracking-tight">Storebase</span>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
        {phase === 'name' ? (
          <Question title="Admin name" hint="This account owns the node.">
            <Input
              autoFocus
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="name"
            />
          </Question>
        ) : null}

        {phase === 'email' ? (
          <Question title="Admin email" hint="Used to sign in as the node owner.">
            <Input
              autoFocus
              className={fieldClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="email"
            />
          </Question>
        ) : null}

        {phase === 'password' ? (
          <Question title="Admin password" hint="At least 8 characters.">
            <Input
              autoFocus
              className={fieldClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="new-password"
            />
          </Question>
        ) : null}

        {phase === 'confirm' ? (
          <Question title="Confirm password">
            <Input
              autoFocus
              className={fieldClass}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={onEnter}
              autoComplete="new-password"
            />
          </Question>
        ) : null}

        {phase === 'storage' ? (
          <Question
            title="How much storage should Storebase use?"
            hint={`${formatBytes(disk.totalBytes)} on this machine, ${formatBytes(disk.freeBytes)} free. Storebase will not write past this reserve.`}
          >
            <div className="rounded-2xl bg-white/[0.04] px-4 py-5">
              <div className="flex items-center justify-end gap-2">
                <Input
                  autoFocus
                  type="number"
                  min={0.1}
                  max={maxGb}
                  step={0.1}
                  value={Number(reserveGb.toFixed(1))}
                  onChange={(e) => setReserveGb(Number(e.target.value))}
                  onKeyDown={onEnter}
                  className="h-10 w-28 rounded-xl border-0 bg-[#242424] text-right"
                />
                <span className="text-sm text-[#8d8d8d]">GB</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={maxGb}
                step={0.1}
                value={Math.min(reserveGb, maxGb)}
                onChange={(e) => setReserveGb(Number(e.target.value))}
                className="mt-4 w-full accent-white"
              />
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-white" style={{ width: `${usedPct}%` }} />
              </div>
              <p className="mt-3 text-xs text-[#8d8d8d]">
                {formatBytes(Math.max(0, remaining))} stays free after this reserve.
              </p>
            </div>
          </Question>
        ) : null}

        {phase === 'people' ? (
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
                  <li key={user.key}>{user.name} · {user.email}</li>
                ))}
              </ul>
            ) : null}
          </Question>
        ) : null}

        {phase === 'user-name' ? (
          <Question title="User name">
            <Input
              autoFocus
              className={fieldClass}
              value={draft.name}
              onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
              onKeyDown={onEnter}
            />
          </Question>
        ) : null}

        {phase === 'user-email' ? (
          <Question title="User email">
            <Input
              autoFocus
              className={fieldClass}
              type="email"
              value={draft.email}
              onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
              onKeyDown={onEnter}
            />
          </Question>
        ) : null}

        {phase === 'user-password' ? (
          <Question title="User password" hint="At least 8 characters.">
            <Input
              autoFocus
              className={fieldClass}
              type="password"
              value={draft.password}
              onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))}
              onKeyDown={onEnter}
            />
          </Question>
        ) : null}

        {error ? <p className="mt-4 text-sm text-[#f28b82]">{error}</p> : null}

        <div className="mt-8 flex flex-wrap gap-2">
          {showBack ? (
            <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={back}>
              Back
            </Button>
          ) : null}

          {phase === 'people' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-11 rounded-full bg-[#242424] text-white hover:bg-[#2e2e2e]"
                onClick={startUser}
              >
                Add a user
              </Button>
              <Button
                type="button"
                className="h-11 flex-1 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
                disabled={busy}
                onClick={() => void finish()}
              >
                {busy ? 'Setting up…' : 'Finish'}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="h-11 flex-1 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
              disabled={busy}
              onClick={advance}
            >
              Continue
            </Button>
          )}
        </div>
      </main>
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
