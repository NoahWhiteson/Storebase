import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBytes } from '@/lib/format'
import { submitSetup, type DiskInfo } from '@/lib/setup'
import { cn } from 'cn'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

type ExtraUser = {
  key: string
  name: string
  email: string
  password: string
}

const fieldClass =
  'h-11 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] focus-visible:ring-1 focus-visible:ring-white/15'

function bytesToGb(bytes: number): number {
  return bytes / 1024 ** 3
}

export function Onboarding({
  disk,
  hostname,
  onDone,
}: {
  disk: DiskInfo
  hostname?: string
  onDone: (account: { name: string; email: string; reservedBytes: number }) => void
}) {
  const maxGb = Math.max(0.1, Math.floor(bytesToGb(disk.freeBytes) * 10) / 10)
  const defaultGb = Math.min(100, Math.max(1, Math.floor(maxGb * 0.5)))
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reserveGb, setReserveGb] = useState(defaultGb)
  const [extras, setExtras] = useState<ExtraUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const remaining = disk.freeBytes - reserveGb * 1024 ** 3
  const usedPct = maxGb > 0 ? Math.min(100, (reserveGb / maxGb) * 100) : 0

  const steps = ['Admin', 'Storage', 'People']

  const extraPayload = useMemo(
    () =>
      extras
        .filter((user) => user.name.trim() || user.email.trim() || user.password)
        .map((user) => ({
          name: user.name.trim(),
          email: user.email.trim(),
          password: user.password,
        })),
    [extras],
  )

  function nextAdmin() {
    if (!name.trim()) return setError('Admin name is required')
    if (!email.includes('@')) return setError('Admin email looks wrong')
    if (password.length < 8) return setError('Admin password must be at least 8 characters')
    if (password !== confirm) return setError('Passwords do not match')
    setError(null)
    setStep(1)
  }

  function nextStorage() {
    if (!(reserveGb > 0) || reserveGb > maxGb) {
      return setError(`Reserve between 0.1 and ${maxGb} GB`)
    }
    setError(null)
    setStep(2)
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

  return (
    <div className="flex min-h-full flex-col bg-[#1a1a1a] text-white">
      <header className="flex h-16 items-center gap-2.5 px-5">
        <StorebaseLogo className="size-8" />
        <span className="text-[20px] font-medium tracking-tight">Storebase</span>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-12">
        <p className="text-sm text-[#8d8d8d]">{hostname ? `This node · ${hostname}` : 'This node'}</p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight">Set up this machine</h1>
        <p className="mt-2 text-sm text-[#8d8d8d]">
          First boot. You become the admin, pick how much disk Storebase can eat, then optionally add other people.
        </p>

        <ol className="mt-8 flex gap-2">
          {steps.map((label, i) => (
            <li
              key={label}
              className={cn(
                'flex-1 rounded-full px-3 py-1.5 text-center text-xs font-medium',
                i === step ? 'bg-white text-[#1a1a1a]' : i < step ? 'bg-white/15 text-white' : 'bg-[#242424] text-[#8d8d8d]',
              )}
            >
              {label}
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-col gap-4">
          {step === 0 ? (
            <>
              <p className="text-sm font-medium text-white">Admin account</p>
              <p className="text-sm text-[#8d8d8d]">
                This is the owner of the node — full control of storage, users, and the drive.
              </p>
              <Field label="Name">
                <Input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Email">
                <Input
                  className={fieldClass}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </Field>
              <Field label="Password">
                <Input
                  className={fieldClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  className={fieldClass}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <p className="text-sm font-medium">Storage reserve</p>
              <p className="text-sm text-[#8d8d8d]">
                This machine has {formatBytes(disk.totalBytes)} total, {formatBytes(disk.freeBytes)} free. Storebase will
                not write past the reserve. The rest stays for the OS and everything else.
              </p>
              <div className="rounded-2xl bg-white/[0.04] px-4 py-5">
                <div className="flex items-end justify-between gap-3">
                  <label className="text-sm text-[#8d8d8d]" htmlFor="reserve">
                    Reserve
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="reserve"
                      type="number"
                      min={0.1}
                      max={maxGb}
                      step={0.1}
                      value={Number(reserveGb.toFixed(1))}
                      onChange={(e) => setReserveGb(Number(e.target.value))}
                      className="h-10 w-24 rounded-xl border-0 bg-[#242424] text-right"
                    />
                    <span className="text-sm text-[#8d8d8d]">GB</span>
                  </div>
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
                  {formatBytes(Math.max(0, remaining))} stays free on the disk after this reserve.
                </p>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="text-sm font-medium">Other users</p>
              <p className="text-sm text-[#8d8d8d]">
                Optional. Add people who can use this drive. You can skip and do it later.
              </p>
              {extras.map((user) => (
                <div key={user.key} className="rounded-2xl bg-white/[0.04] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-[#8d8d8d]">User account</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove user"
                      onClick={() => setExtras((current) => current.filter((row) => row.key !== user.key))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid gap-3">
                    <Input
                      className={fieldClass}
                      placeholder="Name"
                      value={user.name}
                      onChange={(e) =>
                        setExtras((current) =>
                          current.map((row) => (row.key === user.key ? { ...row, name: e.target.value } : row)),
                        )
                      }
                    />
                    <Input
                      className={fieldClass}
                      type="email"
                      placeholder="Email"
                      value={user.email}
                      onChange={(e) =>
                        setExtras((current) =>
                          current.map((row) => (row.key === user.key ? { ...row, email: e.target.value } : row)),
                        )
                      }
                    />
                    <Input
                      className={fieldClass}
                      type="password"
                      placeholder="Password"
                      value={user.password}
                      onChange={(e) =>
                        setExtras((current) =>
                          current.map((row) => (row.key === user.key ? { ...row, password: e.target.value } : row)),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="h-11 rounded-full bg-[#242424] text-white hover:bg-[#2e2e2e]"
                onClick={() =>
                  setExtras((current) => [
                    ...current,
                    { key: crypto.randomUUID(), name: '', email: '', password: '' },
                  ])
                }
              >
                <Plus />
                Add a user
              </Button>
            </>
          ) : null}

          {error ? <p className="text-sm text-[#f28b82]">{error}</p> : null}

          <div className="mt-2 flex gap-2">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-full"
                onClick={() => {
                  setError(null)
                  setStep((s) => s - 1)
                }}
              >
                Back
              </Button>
            ) : null}
            {step === 0 ? (
              <Button type="button" className="h-11 flex-1 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" onClick={nextAdmin}>
                Continue
              </Button>
            ) : null}
            {step === 1 ? (
              <Button type="button" className="h-11 flex-1 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" onClick={nextStorage}>
                Continue
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                type="button"
                className="h-11 flex-1 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
                disabled={busy}
                onClick={() => void finish()}
              >
                {busy ? 'Setting up…' : extras.length ? 'Create node' : 'Skip and finish'}
              </Button>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-[#8d8d8d]">{label}</span>
      {children}
    </label>
  )
}
