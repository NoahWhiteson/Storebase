import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatBytes, formatDate } from '@/lib/format'
import {
  applyUpdate,
  checkUpdate,
  createUser,
  deleteUser,
  fetchSettings,
  patchUser,
  rotateSecret,
  saveAccount,
  saveSettings,
  type SettingsPayload,
  type SettingsUser,
} from '@/lib/settings'
import { cn } from 'cn'
import {
  ArrowLeft,
  HardDrive,
  KeyRound,
  RefreshCw,
  Server,
  Shield,
  SlidersHorizontal,
  SquareTerminal,
  UserRound,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const fieldClass =
  'h-11 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'

export type SettingsSection = 'account' | 'general' | 'server' | 'storage' | 'users' | 'updates' | 'security' | 'terminals'

type Account = { id: string; name: string; email: string; role: 'admin' | 'user' }

export function Settings({
  account,
  initialSection = 'account',
  onClose,
  onAccount,
  onPlatform,
  onToast,
}: {
  account: Account
  initialSection?: SettingsSection
  onClose: () => void
  onAccount: (next: { name: string; email: string }) => void
  onPlatform?: (next: { defaultView?: 'grid' | 'list'; terminalsEnabled?: boolean }) => void
  onToast: (message: string) => void
}) {
  const [section, setSection] = useState<SettingsSection>(
    account.role === 'admin' || initialSection === 'account' ? initialSection : 'account',
  )
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchSettings())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const admin = Boolean(data?.admin ?? account.role === 'admin')

  useEffect(() => {
    setSection(admin || initialSection === 'account' ? initialSection : 'account')
  }, [admin, initialSection])

  const nav: { id: SettingsSection; label: string; icon: typeof UserRound; admin?: boolean }[] = [
    { id: 'account', label: 'Account', icon: UserRound },
    { id: 'general', label: 'Platform', icon: SlidersHorizontal, admin: true },
    { id: 'server', label: 'Server', icon: Server, admin: true },
    { id: 'storage', label: 'Storage', icon: HardDrive, admin: true },
    { id: 'users', label: 'Users', icon: Users, admin: true },
    { id: 'terminals', label: 'Terminals', icon: SquareTerminal, admin: true },
    { id: 'updates', label: 'Updates', icon: RefreshCw, admin: true },
    { id: 'security', label: 'Security', icon: Shield, admin: true },
  ]

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-[#1a1a1a]">
      <aside className="hidden w-[256px] shrink-0 flex-col md:flex">
        <button
          type="button"
          onClick={onClose}
          className="mx-4 mt-3 mb-2 flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[#b3b3b3] hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to files
        </button>
        <ScrollArea className="flex-1 px-3">
          <nav className="flex flex-col gap-0.5 py-1">
            {nav
              .filter((item) => !item.admin || admin)
              .map((item) => {
                const Icon = item.icon
                const active = section === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cn(
                      'flex h-10 items-center gap-3 rounded-full px-4 text-sm font-medium',
                      active ? 'bg-white/10 text-white' : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <Icon className="size-[18px]" />
                    {item.label}
                  </button>
                )
              })}
          </nav>
        </ScrollArea>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
        <div className="mb-6 flex items-center gap-2 md:hidden">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            <ArrowLeft />
            Files
          </Button>
        </div>
        <div className="mb-6 flex flex-wrap gap-2 md:hidden">
          {nav
            .filter((item) => !item.admin || admin)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  'h-8 rounded-full px-3 text-sm',
                  section === item.id ? 'bg-white text-[#1a1a1a]' : 'bg-white/[0.08] text-[#e8e8e8]',
                )}
              >
                {item.label}
              </button>
            ))}
        </div>

        {loading && !data ? <p className="text-sm text-[#8d8d8d]">Loading settings…</p> : null}
        {error ? (
          <div className="mb-4 max-w-lg">
            <p className="text-sm text-[#f28b82]">{error}</p>
            <p className="mt-2 text-sm text-[#8d8d8d]">
              Settings talks to this node over <code className="text-[#e8e8e8]">/api/settings</code>. If the page is empty
              after an install, rebuild from the machine:
            </p>
            <pre className="mt-3 rounded-xl bg-[#242424] px-4 py-3 text-sm text-[#e8e8e8]">storebase update</pre>
          </div>
        ) : null}

        {data && section === 'account' ? (
          <AccountPanel data={data} onSaved={onAccount} onToast={onToast} />
        ) : null}
        {data && admin && section === 'general' ? (
          <GeneralPanel data={data} onSaved={reload} onPlatform={onPlatform} onToast={onToast} />
        ) : null}
        {data && admin && section === 'server' ? (
          <ServerPanel data={data} onSaved={reload} onToast={onToast} />
        ) : null}
        {data && admin && section === 'storage' ? (
          <StoragePanel data={data} onSaved={reload} onToast={onToast} />
        ) : null}
        {data && admin && section === 'users' ? (
          <UsersPanel meId={account.id} users={data.users ?? []} onSaved={reload} onToast={onToast} />
        ) : null}
        {data && admin && section === 'terminals' ? (
          <TerminalsPanel data={data} onSaved={reload} onPlatform={onPlatform} onToast={onToast} />
        ) : null}
        {data && admin && section === 'updates' ? (
          <UpdatesPanel data={data} onSaved={reload} onToast={onToast} />
        ) : null}
        {data && admin && section === 'security' ? <SecurityPanel onToast={onToast} /> : null}
      </main>
    </div>
  )
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-medium tracking-tight text-white">{title}</h1>
      <p className="mt-1 text-sm text-[#8d8d8d]">{hint}</p>
    </div>
  )
}

function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn('flex items-center justify-between gap-4 py-2 text-left', disabled && 'opacity-40')}
    >
      <span className="text-sm text-[#e8e8e8]">{label}</span>
      <span className={cn('relative h-6 w-11 rounded-full transition', on ? 'bg-white' : 'bg-white/20')}>
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full transition',
            on ? 'left-5 bg-[#1a1a1a]' : 'left-0.5 bg-white',
          )}
        />
      </span>
    </button>
  )
}

function AccountPanel({
  data,
  onSaved,
  onToast,
}: {
  data: SettingsPayload
  onSaved: (next: { name: string; email: string }) => void
  onToast: (message: string) => void
}) {
  const [name, setName] = useState(data.account.name)
  const [email, setEmail] = useState(data.account.email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const user = await saveAccount({
        name,
        email,
        currentPassword: newPassword ? currentPassword : undefined,
        newPassword: newPassword || undefined,
      })
      onSaved({ name: user.name, email: user.email })
      setCurrentPassword('')
      setNewPassword('')
      onToast('Account saved')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Heading title="Account" hint="This is how you show up on this node." />
      <label className="mb-4 block text-sm text-[#8d8d8d]">
        Name
        <Input className={`${fieldClass} mt-1.5`} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="mb-4 block text-sm text-[#8d8d8d]">
        Email
        <Input className={`${fieldClass} mt-1.5`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <p className="mb-2 text-sm text-[#8d8d8d]">Change password</p>
      <Input
        className={`${fieldClass} mb-2`}
        type="password"
        placeholder="Current password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
      />
      <Input
        className={`${fieldClass} mb-6`}
        type="password"
        placeholder="New password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <p className="mb-6 text-sm text-[#8d8d8d]">
        Your files use {formatBytes(data.account.usedBytes)} of {formatBytes(data.account.reservedBytes)} on this node.
      </p>
      <Button className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function GeneralPanel({
  data,
  onSaved,
  onPlatform,
  onToast,
}: {
  data: SettingsPayload
  onSaved: () => Promise<void>
  onPlatform?: (next: { defaultView?: 'grid' | 'list'; terminalsEnabled?: boolean }) => void
  onToast: (message: string) => void
}) {
  const [nodeName, setNodeName] = useState(data.platform.nodeName)
  const [signInMessage, setSignInMessage] = useState(data.platform.signInMessage ?? '')
  const [defaultView, setDefaultView] = useState(data.platform.defaultView)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await saveSettings({ platform: { nodeName, signInMessage, defaultView } })
      onPlatform?.({ defaultView })
      await onSaved()
      onToast('Platform saved')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Heading title="Platform" hint="How this Storebase node presents itself." />
      <label className="mb-4 block text-sm text-[#8d8d8d]">
        Node name
        <Input className={`${fieldClass} mt-1.5`} value={nodeName} onChange={(e) => setNodeName(e.target.value)} />
      </label>
      <label className="mb-4 block text-sm text-[#8d8d8d]">
        Sign-in note
        <Input
          className={`${fieldClass} mt-1.5`}
          value={signInMessage}
          onChange={(e) => setSignInMessage(e.target.value)}
          placeholder="Optional line under Sign in"
        />
      </label>
      <p className="mb-2 text-sm text-[#8d8d8d]">Default file view</p>
      <div className="mb-6 flex gap-2">
        {(['grid', 'list'] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setDefaultView(view)}
            className={cn(
              'h-9 rounded-full px-4 text-sm capitalize',
              defaultView === view ? 'bg-white text-[#1a1a1a]' : 'bg-white/[0.08] text-[#e8e8e8]',
            )}
          >
            {view}
          </button>
        ))}
      </div>
      <Button className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function ServerPanel({
  data,
  onSaved,
  onToast,
}: {
  data: SettingsPayload
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const server = data.server
  const [bindHost, setBindHost] = useState(server?.bindHost ?? '127.0.0.1')
  const [bindPort, setBindPort] = useState(String(server?.bindPort ?? 4780))
  const [busy, setBusy] = useState(false)
  if (!server) return null

  async function save() {
    setBusy(true)
    try {
      await saveSettings({ platform: { bindHost, bindPort: Number(bindPort) } })
      await onSaved()
      onToast('Bind address saved. Restart the node to apply it.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Heading title="Server" hint="Live process vs what the next restart will use." />
      <Row label="Hostname" value={server.hostname} />
      <Row label="Listening now" value={`${server.liveHost}:${server.livePort}`} />
      <Row label="Data" value={server.dataDir} />
      <Row label="Drive" value={server.driveDir} />
      <Row label="Install" value={server.homeDir} />
      <label className="mt-6 mb-3 block text-sm text-[#8d8d8d]">
        Bind address
        <Input className={`${fieldClass} mt-1.5`} value={bindHost} onChange={(e) => setBindHost(e.target.value)} />
      </label>
      <label className="mb-4 block text-sm text-[#8d8d8d]">
        Port
        <Input className={`${fieldClass} mt-1.5`} value={bindPort} onChange={(e) => setBindPort(e.target.value)} />
      </label>
      {server.restartNeeded ? (
        <p className="mb-4 text-sm text-[#e8c07d]">Restart the Storebase node to pick up the new bind address.</p>
      ) : (
        <p className="mb-4 text-sm text-[#8d8d8d]">Changing bind/port writes `.env` and takes effect on restart.</p>
      )}
      <Button className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/5 py-3 sm:flex-row sm:items-baseline sm:justify-between">
      <span className="text-sm text-[#8d8d8d]">{label}</span>
      <span className="text-sm break-all text-[#e8e8e8]">{value}</span>
    </div>
  )
}

function StoragePanel({
  data,
  onSaved,
  onToast,
}: {
  data: SettingsPayload
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const storage = data.storage
  const users = data.users ?? []
  const [gb, setGb] = useState(storage ? Math.max(0.1, Math.round(storage.reservedGb * 10) / 10) : 1)
  const [busy, setBusy] = useState(false)
  const maxGb = useMemo(() => {
    if (!storage) return 1
    return Math.max(0.1, (storage.disk.freeBytes + storage.poolUsedBytes) / 1024 ** 3)
  }, [storage])
  const minGb = useMemo(() => {
    if (!storage) return 0.1
    return Math.max(0.1, storage.poolUsedBytes / 1024 ** 3)
  }, [storage])
  if (!storage) return null
  const usedPct = Math.min(100, Math.round((storage.poolUsedBytes / Math.max(1, storage.reservedBytes)) * 100))

  async function save() {
    setBusy(true)
    try {
      await saveSettings({ storage: { reserveGb: gb } })
      await onSaved()
      onToast('Storage cap saved')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl">
      <Heading title="Storage" hint="Hard cap for every account on this node." />
      <div className="mb-2 flex items-end gap-2">
        <span className="text-[56px] leading-none font-medium tracking-tight tabular-nums">{gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)}</span>
        <span className="mb-1 text-xl text-[#8d8d8d]">GB</span>
      </div>
      <input
        type="range"
        min={Math.round(minGb * 10) / 10}
        max={Math.round(maxGb * 10) / 10}
        step={maxGb >= 100 ? 1 : 0.1}
        value={gb}
        onChange={(e) => setGb(Number(e.target.value))}
        className="disk-slider"
      />
      <p className="mt-2 mb-5 text-sm text-[#8d8d8d]">
        {formatBytes(storage.poolUsedBytes)} used · {formatBytes(storage.disk.freeBytes)} free on disk
      </p>
      <Progress value={usedPct} className="mb-8 h-1 bg-white/10" />
      <div className="mb-8 space-y-3">
        {users.map((user) => (
          <div key={user.id} className="flex items-center justify-between text-sm">
            <span className="text-[#e8e8e8]">
              {user.name}
              <span className="text-[#8d8d8d]"> · {user.role}</span>
            </span>
            <span className="tabular-nums text-[#8d8d8d]">{formatBytes(user.usedBytes)}</span>
          </div>
        ))}
      </div>
      <Button className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save cap'}
      </Button>
    </div>
  )
}

function UsersPanel({
  meId,
  users,
  onSaved,
  onToast,
}: {
  meId: string
  users: SettingsUser[]
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      await createUser({ name, email, password, role })
      setName('')
      setEmail('')
      setPassword('')
      setRole('user')
      await onSaved()
      onToast(`Added ${name.trim() || email}`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not add user')
    } finally {
      setBusy(false)
    }
  }

  async function setRoleFor(user: SettingsUser, next: 'admin' | 'user') {
    try {
      await patchUser(user.id, { role: next })
      await onSaved()
      onToast(`${user.name} is now ${next}`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not change role')
    }
  }

  async function resetPassword(user: SettingsUser) {
    const next = window.prompt(`New password for ${user.email} (8+ characters)`)
    if (!next) return
    try {
      await patchUser(user.id, { password: next })
      onToast(`Password updated for ${user.name}`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not set password')
    }
  }

  async function remove(user: SettingsUser) {
    if (!window.confirm(`Delete ${user.name} and their files on this node?`)) return
    try {
      await deleteUser(user.id)
      await onSaved()
      onToast(`Removed ${user.name}`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  return (
    <div className="max-w-3xl">
      <Heading title="Users" hint="Each account gets its own drive on this machine." />
      <div className="mb-8 grid gap-2 sm:grid-cols-2">
        <Input className={fieldClass} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className={fieldClass} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          className={fieldClass}
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRole('user')}
            className={cn(
              'h-11 flex-1 rounded-xl text-sm',
              role === 'user' ? 'bg-white text-[#1a1a1a]' : 'bg-[#242424] text-[#e8e8e8]',
            )}
          >
            User
          </button>
          <button
            type="button"
            onClick={() => setRole('admin')}
            className={cn(
              'h-11 flex-1 rounded-xl text-sm',
              role === 'admin' ? 'bg-white text-[#1a1a1a]' : 'bg-[#242424] text-[#e8e8e8]',
            )}
          >
            Admin
          </button>
        </div>
      </div>
      <Button className="mb-10 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add user'}
      </Button>

      <div className="space-y-2">
        {users.map((user) => (
          <div key={user.id} className="rounded-2xl bg-white/[0.04] px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">
                  {user.name}
                  {user.id === meId ? <span className="text-[#8d8d8d]"> · you</span> : null}
                </div>
                <div className="text-sm text-[#8d8d8d]">{user.email}</div>
                <div className="mt-1 text-xs text-[#8d8d8d]">
                  {user.role} · {formatBytes(user.usedBytes)}
                  {user.createdAt ? ` · ${formatDate(user.createdAt)}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  className="h-8 rounded-full"
                  onClick={() => void setRoleFor(user, user.role === 'admin' ? 'user' : 'admin')}
                >
                  {user.role === 'admin' ? 'Make user' : 'Make admin'}
                </Button>
                <Button variant="ghost" className="h-8 rounded-full" onClick={() => void resetPassword(user)}>
                  Password
                </Button>
                {user.id !== meId ? (
                  <Button variant="ghost" className="h-8 rounded-full text-[#f28b82]" onClick={() => void remove(user)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TerminalsPanel({
  data,
  onSaved,
  onPlatform,
  onToast,
}: {
  data: SettingsPayload
  onSaved: () => Promise<void>
  onPlatform?: (next: { terminalsEnabled?: boolean }) => void
  onToast: (message: string) => void
}) {
  const [enabled, setEnabled] = useState(data.platform.terminalEnabled !== false)
  const [max, setMax] = useState(String(data.platform.terminalMax ?? 4))
  const [idle, setIdle] = useState(String(data.platform.terminalIdleMinutes ?? 30))
  const [allowUsers, setAllowUsers] = useState(data.platform.terminalUsers !== false)
  const [busy, setBusy] = useState(false)

  async function saveEnabled(next: boolean) {
    setEnabled(next)
    try {
      await saveSettings({ platform: { terminalEnabled: next } })
      onPlatform?.({ terminalsEnabled: next })
      await onSaved()
      onToast(next ? 'Terminals on' : 'Terminals off. Live shells killed.')
    } catch (err) {
      setEnabled(!next)
      onToast(err instanceof Error ? err.message : 'Could not save')
    }
  }

  async function save() {
    setBusy(true)
    try {
      await saveSettings({
        platform: {
          terminalEnabled: enabled,
          terminalMax: Number(max),
          terminalIdleMinutes: Number(idle),
          terminalUsers: allowUsers,
        },
      })
      onPlatform?.({ terminalsEnabled: enabled })
      await onSaved()
      onToast('Terminal settings saved')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Heading
        title="Terminals"
        hint="Master switch for live shells on this machine. Off hides the tab and kills every session."
      />
      <Toggle on={enabled} onChange={(next) => void saveEnabled(next)} label="Enable terminals" />
      <div className={cn('mt-6', !enabled && 'pointer-events-none opacity-40')}>
        <label className="mb-4 block text-sm text-[#8d8d8d]">
          Max live terminals per user
          <Input
            className={`${fieldClass} mt-1.5`}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            disabled={!enabled}
          />
        </label>
        <label className="mb-4 block text-sm text-[#8d8d8d]">
          Idle expiry (minutes, 0 = never)
          <Input
            className={`${fieldClass} mt-1.5`}
            value={idle}
            onChange={(e) => setIdle(e.target.value)}
            disabled={!enabled}
          />
        </label>
        <Toggle
          on={allowUsers}
          onChange={setAllowUsers}
          label="Allow non-admin users to open terminals"
          disabled={!enabled}
        />
      </div>
      <Button
        className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
        disabled={busy || !enabled}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function UpdatesPanel({
  data,
  onSaved,
  onToast,
}: {
  data: SettingsPayload
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const update = data.update
  const [auto, setAuto] = useState(Boolean(update?.autoUpdate ?? data.platform.autoUpdate))
  const [busy, setBusy] = useState(false)

  async function saveAuto(next: boolean) {
    setAuto(next)
    try {
      await saveSettings({ platform: { autoUpdate: next } })
      await onSaved()
      onToast(next ? 'Auto-update on' : 'Auto-update off')
    } catch (err) {
      setAuto(!next)
      onToast(err instanceof Error ? err.message : 'Could not save')
    }
  }

  async function check() {
    setBusy(true)
    try {
      const next = await checkUpdate()
      await onSaved()
      onToast(next.available ? 'Update available' : 'Already current')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    setBusy(true)
    try {
      await applyUpdate()
      onToast('Updating. The node will restart.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Heading title="Updates" hint="Opt-in. Nothing pulls GitHub unless you run the command or click Update." />
      <p className="mb-2 text-sm text-[#8d8d8d]">On the machine:</p>
      <pre className="mb-6 rounded-xl bg-[#242424] px-4 py-3 text-sm text-[#e8e8e8]">storebase update</pre>
      <p className="mb-6 text-sm text-[#8d8d8d]">
        That fetches GitHub main, rebuilds the web UI, and restarts the node. Use{' '}
        <code className="text-[#e8e8e8]">storebase update --check</code> to look without applying.
      </p>
      <Toggle on={auto} onChange={(next) => void saveAuto(next)} label="Also auto-update every 6 hours" />
      <div className="mt-6 space-y-3 text-sm">
        <Row label="This install" value={update?.currentSha?.slice(0, 7) ?? 'unknown'} />
        <Row label="GitHub main" value={update?.latestSha?.slice(0, 7) ?? 'unknown'} />
        <Row label="Latest commit" value={update?.latestMessage ?? '—'} />
        <Row label="Last check" value={update?.lastCheckedAt ? formatDate(update.lastCheckedAt) : 'Never'} />
      </div>
      {update?.lastError ? <p className="mt-4 text-sm text-[#f28b82]">{update.lastError}</p> : null}
      {update?.available ? (
        <p className="mt-4 text-sm text-[#e8c07d]">A newer main is on GitHub.</p>
      ) : (
        <p className="mt-4 text-sm text-[#8d8d8d]">This node matches GitHub, or Git is not available.</p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          className="h-11 rounded-full bg-[#242424] text-white hover:bg-[#2e2e2e]"
          disabled={busy}
          onClick={() => void check()}
        >
          Check now
        </Button>
        <Button
          className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
          disabled={busy}
          onClick={() => void apply()}
        >
          Update now
        </Button>
      </div>
    </div>
  )
}

function SecurityPanel({ onToast }: { onToast: (message: string) => void }) {
  const [busy, setBusy] = useState(false)

  async function rotate() {
    if (!window.confirm('This signs everyone out except you. Continue?')) return
    setBusy(true)
    try {
      await rotateSecret()
      onToast('Session secret rotated. Other sessions are dead.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not rotate')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Heading title="Security" hint="Sessions are httpOnly cookies signed with a local secret." />
      <p className="mb-6 text-sm text-[#8d8d8d]">
        Rotate the signing secret if you think a cookie leaked. Everyone else has to sign in again. You stay on.
      </p>
      <Button
        className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
        disabled={busy}
        onClick={() => void rotate()}
      >
        <KeyRound className="size-4" />
        {busy ? 'Rotating…' : 'Rotate session secret'}
      </Button>
    </div>
  )
}
