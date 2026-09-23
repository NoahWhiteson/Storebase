import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { copyText } from '@/lib/clipboard'
import { formatBytes, formatDate } from '@/lib/format'
import {
  addStorageBackend,
  applyUpdate,
  checkUpdate,
  createUser,
  deleteStorageBackend,
  deleteUser,
  fetchPairing,
  fetchSettings,
  fetchVirusInstall,
  installVirusEngine,
  patchUser,
  refreshDomain,
  reconnectStorageBackend,
  revokeDevice,
  rotateNetworkToken,
  rotatePairCode,
  rotateSecret,
  saveAccount,
  saveDomain,
  saveSettings,
  setNetworkInbound,
  setStoreOrder,
  testStorageBackend,
  clearDomain,
  type DiagnosticsPayload,
  type DomainInfo,
  type PairingInfo,
  type SettingsPayload,
  type SettingsUser,
} from '@/lib/settings'
import { cn } from 'cn'
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe,
  HardDrive,
  KeyRound,
  Laptop,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  UserRound,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const fieldClass =
  'h-11 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'

export type SettingsSection =
  | 'account'
  | 'devices'
  | 'general'
  | 'virus'
  | 'server'
  | 'storage'
  | 'users'
  | 'updates'
  | 'security'
  | 'terminals'
  | 'domain'
  | 'diagnostics'

type Account = { id: string; name: string; email: string; role: 'admin' | 'user'; virusScanEnabled?: boolean; operationNotifications?: boolean }

type SettingsNavItem = {
  id: SettingsSection
  label: string
  icon: typeof UserRound
  admin?: boolean
  keywords: string
}

const settingsGroups: { id: string; label: string; items: SettingsNavItem[] }[] = [
  {
    id: 'personal',
    label: 'Personal',
    items: [
      { id: 'general', label: 'General', icon: SlidersHorizontal, keywords: 'preferences operations notifications view' },
      { id: 'account', label: 'Account', icon: UserRound, keywords: 'profile name email password quota' },
      { id: 'devices', label: 'Mac app', icon: Laptop, keywords: 'device pairing capture macos' },
    ],
  },
  {
    id: 'node',
    label: 'Node',
    items: [
      { id: 'server', label: 'Server', icon: Server, admin: true, keywords: 'host port data drive install' },
      { id: 'domain', label: 'Domain', icon: Globe, admin: true, keywords: 'hostname dns https ssl' },
      { id: 'storage', label: 'Storage', icon: HardDrive, admin: true, keywords: 'capacity reserve backend disk' },
      { id: 'users', label: 'Users', icon: Users, admin: true, keywords: 'members accounts quota roles' },
    ],
  },
  {
    id: 'protection',
    label: 'Protection',
    items: [
      { id: 'virus', label: 'Virus scanning', icon: ShieldCheck, keywords: 'clamav malware upload scan antivirus' },
      { id: 'security', label: 'Security', icon: Shield, admin: true, keywords: 'secret session encryption' },
      { id: 'terminals', label: 'Terminals', icon: SquareTerminal, admin: true, keywords: 'shell command console' },
    ],
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    items: [
      { id: 'updates', label: 'Updates', icon: RefreshCw, admin: true, keywords: 'version upgrade release automatic' },
      { id: 'diagnostics', label: 'Diagnostics', icon: Activity, admin: true, keywords: 'performance speed timing debug memory requests cache slow' },
    ],
  },
]

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
  onAccount: (next: { name: string; email: string; virusScanEnabled?: boolean; operationNotifications?: boolean }) => void
  onPlatform?: (next: { defaultView?: 'grid' | 'list'; terminalsEnabled?: boolean }) => void
  onToast: (message: string) => void
}) {
  const [section, setSection] = useState<SettingsSection>(
    account.role === 'admin' || ['account', 'devices', 'general', 'virus'].includes(initialSection)
      ? initialSection
      : 'account',
  )
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loadedSections = useRef(new Set<SettingsSection>())
  const loadSequence = useRef(0)

  async function loadSection(target: SettingsSection, force = false) {
    const request = ++loadSequence.current
    if (!force && loadedSections.current.has(target)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await fetchSettings(target)
      setData((current) => current ? {
        ...current,
        ...next,
        account: { ...current.account, ...next.account },
        platform: { ...current.platform, ...next.platform },
      } : next)
      loadedSections.current.add(target)
    } catch (err) {
      if (request === loadSequence.current) setError(err instanceof Error ? err.message : 'Could not load settings')
    } finally {
      if (request === loadSequence.current) setLoading(false)
    }
  }

  async function reload() {
    await loadSection(section, true)
  }

  useEffect(() => {
    if (section === 'devices') {
      loadSequence.current += 1
      setLoading(false)
      setError(null)
      return
    }
    void loadSection(section)
  }, [section])

  const admin = Boolean(data?.admin ?? account.role === 'admin')

  useEffect(() => {
    setSection(admin || ['account', 'devices', 'general', 'virus'].includes(initialSection) ? initialSection : 'account')
  }, [admin, initialSection])

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
          <SettingsNavigation admin={admin} section={section} onSection={setSection} />
        </ScrollArea>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
        <div className="mb-6 flex items-center gap-2 md:hidden">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            <ArrowLeft />
            Files
          </Button>
        </div>
        <div className="mb-6 md:hidden">
          <SettingsNavigation admin={admin} section={section} onSection={setSection} />
        </div>

        {loading ? (
          <div className="mb-5 flex items-center gap-2 text-sm text-[#8d8d8d]" role="status">
            <span className="size-3.5 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
            Loading this section…
          </div>
        ) : null}
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

        {!loading && data && section === 'account' ? (
          <AccountPanel data={data} onSaved={onAccount} onToast={onToast} />
        ) : null}
        {section === 'devices' ? <DevicesPanel onToast={onToast} /> : null}
        {!loading && data && section === 'general' ? (
          <GeneralPanel data={data} admin={admin} onSaved={reload} onAccount={onAccount} onPlatform={onPlatform} onToast={onToast} />
        ) : null}
        {!loading && data && section === 'virus' ? (
          <VirusPanel data={data} admin={admin} onSaved={reload} onAccount={onAccount} onToast={onToast} />
        ) : null}
        {!loading && data && admin && section === 'server' ? (
          <ServerPanel data={data} onSaved={reload} onToast={onToast} />
        ) : null}
        {!loading && data && admin && section === 'domain' ? (
          <DomainPanel data={data} onSaved={reload} onToast={onToast} />
        ) : null}
        {!loading && data && admin && section === 'storage' ? (
          <StoragePanel data={data} onSaved={reload} onToast={onToast} />
        ) : null}
        {!loading && data && admin && section === 'users' ? (
          <UsersPanel
            meId={account.id}
            users={data.users ?? []}
            nodeGb={(data.account.nodeReservedBytes ?? 0) / 1024 ** 3}
            onSaved={reload}
            onToast={onToast}
          />
        ) : null}
        {!loading && data && admin && section === 'terminals' ? (
          <TerminalsPanel data={data} onSaved={reload} onPlatform={onPlatform} onToast={onToast} />
        ) : null}
        {!loading && data && admin && section === 'updates' ? (
          <UpdatesPanel data={data} onSaved={reload} onToast={onToast} />
        ) : null}
        {!loading && data && admin && section === 'security' ? <SecurityPanel onToast={onToast} /> : null}
        {!loading && data && admin && section === 'diagnostics' ? (
          <DiagnosticsPanel data={data.diagnostics} onSaved={reload} onToast={onToast} />
        ) : null}
      </main>
    </div>
  )
}

function SettingsNavigation({
  admin,
  section,
  onSection,
}: {
  admin: boolean
  section: SettingsSection
  onSection: (section: SettingsSection) => void
}) {
  const activeGroup = settingsGroups.find((group) => group.items.some((item) => item.id === section))?.id
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(['personal', 'protection', activeGroup].filter(Boolean) as string[]),
  )

  const normalizedQuery = query.trim().toLowerCase()
  const groups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.admin && !admin) return false
        if (!normalizedQuery) return true
        return `${group.label} ${item.label} ${item.keywords}`.toLowerCase().includes(normalizedQuery)
      }),
    }))
    .filter((group) => group.items.length > 0)

  function toggleGroup(id: string) {
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <nav className="py-1" aria-label="Settings sections">
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#777]" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 rounded-full border-0 bg-white/[0.06] pr-3 pl-9 text-sm text-white shadow-none placeholder:text-[#777] focus-visible:ring-1 focus-visible:ring-white/20"
          placeholder="Search settings"
          aria-label="Search settings"
        />
      </label>
      <div className="space-y-1">
        {groups.map((group) => {
          const open = normalizedQuery.length > 0 || openGroups.has(group.id)
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-xs font-medium tracking-wide text-[#8d8d8d] uppercase hover:bg-white/[0.04] hover:text-[#bdbdbd]"
                aria-expanded={open}
              >
                {group.label}
                <ChevronRight
                  className={cn(
                    'size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
                    open && 'rotate-90',
                  )}
                />
              </button>
              <div
                className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
                  open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                )}
              >
                <div className="overflow-hidden">
                  <div className="mb-2 space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      const active = section === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSection(item.id)}
                          className={cn(
                            'flex h-10 w-full items-center gap-3 rounded-full px-4 text-sm font-medium transition-[background-color,color,transform] duration-150 motion-reduce:transition-none',
                            active ? 'bg-white/10 text-white' : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
                          )}
                        >
                          <Icon className="size-[18px]" />
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {groups.length === 0 ? <p className="px-3 py-4 text-sm text-[#777]">No settings found.</p> : null}
      </div>
    </nav>
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

function SettingsCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5">
      <h2 className="text-sm font-medium text-white">{title}</h2>
      <p className="mt-1 mb-4 text-xs leading-5 text-[#8d8d8d]">{hint}</p>
      {children}
    </section>
  )
}

function SettingsTable({ headings, children, minWidth = 640 }: { headings: string[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.025]">
      <table className="w-full border-collapse text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-white/[0.08] bg-white/[0.035]">
            {headings.map((heading) => (
              <th key={heading} className="px-4 py-3 text-xs font-medium tracking-wide text-[#8d8d8d] uppercase">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">{children}</tbody>
      </table>
    </div>
  )
}

const tableCellClass = 'border-b border-white/[0.06] px-4 py-3 align-middle text-[#e8e8e8]'

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-4">
      <p className="text-xs font-medium tracking-wide text-[#8d8d8d] uppercase">{label}</p>
      <p className="mt-1 text-xl font-medium tracking-tight text-white tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-xs text-[#777]">{detail}</p> : null}
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

function DevicesPanel({ onToast }: { onToast: (message: string) => void }) {
  const [info, setInfo] = useState<PairingInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      setInfo(await fetchPairing())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pairing')
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function copy(label: string, value: string) {
    const ok = await copyText(value)
    onToast(ok ? `Copied ${label}` : 'Could not copy')
  }

  async function rotate() {
    setBusy(true)
    try {
      const next = await rotatePairCode()
      setInfo((current) => (current ? { ...current, code: next.code } : current))
      onToast('New pairing code. Old unused codes are dead.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not rotate')
    } finally {
      setBusy(false)
    }
  }

  async function drop(id: string) {
    setBusy(true)
    try {
      await revokeDevice(id)
      onToast('Mac disconnected')
      await reload()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not revoke')
    } finally {
      setBusy(false)
    }
  }

  const url = info?.urls[0] ?? ''

  return (
    <div className="max-w-lg">
      <Heading
        title="Mac app"
        hint="This page is only pairing. Capture, menu-bar chips, and drag-download all live in the Mac app."
      />
      {error ? <p className="mb-4 text-sm text-[#f28b82]">{error}</p> : null}
      {!info ? (
        <p className="text-sm text-[#8d8d8d]">Loading pairing…</p>
      ) : (
        <>
          <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#8d8d8d]">
            <li>
              On the Mac: <code className="text-[#e8e8e8]">cd macos && ./make-dmg.sh</code> from{' '}
              <a
                href="https://github.com/NoahWhiteson/Storebase/tree/main/macos"
                className="text-white underline decoration-white/20 underline-offset-2 hover:decoration-white"
                target="_blank"
                rel="noreferrer"
              >
                the repo
              </a>
              . Window should say 1.13.
            </li>
            <li>Paste the node link and pairing code below. Off-LAN use the public IP or a domain — never 0.0.0.0, and not a 10.x / 192.168.x the Mac can’t route.</li>
            <li>Turn Capture on. New Downloads go to this drive, then the local file becomes a tagged cloud copy (real name, almost no disk).</li>
            <li>To drag a cloud copy into Mail, Messages, or Desktop: click it first, wait for the menu-bar percent, then drag. Otherwise Finder copies the empty stub.</li>
          </ol>
          <p className="mb-2 text-sm text-[#8d8d8d]">Node link</p>
          <div className="mb-4 flex gap-2">
            <Input readOnly className={fieldClass} value={url} />
            <Button
              className="h-11 shrink-0 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]"
              onClick={() => void copy('link', url)}
            >
              Copy
            </Button>
          </div>
          {info.urls.length > 1 ? (
            <p className="mb-4 text-xs text-[#8d8d8d]">Also reachable at {info.urls.slice(1).join(' · ')}</p>
          ) : null}
          <p className="mb-2 text-sm text-[#8d8d8d]">Pairing code</p>
          <div className="mb-4 flex gap-2">
            <Input readOnly className={`${fieldClass} font-mono tracking-[0.2em]`} value={info.code} />
            <Button
              className="h-11 shrink-0 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]"
              onClick={() => void copy('code', info.code)}
            >
              Copy
            </Button>
          </div>
          <Button
            variant="outline"
            className="mb-8 h-10 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
            disabled={busy}
            onClick={() => void rotate()}
          >
            New code
          </Button>
          <h2 className="mb-2 text-sm font-medium text-white">Paired Macs</h2>
          {info.devices.length === 0 ? (
            <p className="text-sm text-[#8d8d8d]">None yet. Open the Mac app and connect.</p>
          ) : (
            <ul className="space-y-2">
              {info.devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-[#242424] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{device.name}</p>
                    <p className="text-xs text-[#8d8d8d]">Last seen {formatDate(device.lastSeenAt)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-8 rounded-full text-[#f28b82] hover:bg-white/5 hover:text-[#f28b82]"
                    disabled={busy}
                    onClick={() => void drop(device.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function AccountPanel({
  data,
  onSaved,
  onToast,
}: {
  data: SettingsPayload
  onSaved: (next: { name: string; email: string; virusScanEnabled?: boolean; operationNotifications?: boolean }) => void
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
      onSaved({ name: user.name, email: user.email, virusScanEnabled: user.virusScanEnabled, operationNotifications: user.operationNotifications })
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
        Your files use {formatBytes(data.account.usedBytes)} of {formatBytes(data.account.reservedBytes)}
        {data.account.quotaBytes ? ' (your cap)' : ' on this node'}.
      </p>
      <Button className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function GeneralPanel({
  data,
  admin,
  onSaved,
  onAccount,
  onPlatform,
  onToast,
}: {
  data: SettingsPayload
  admin: boolean
  onSaved: () => Promise<void>
  onAccount: (next: { name: string; email: string; virusScanEnabled?: boolean; operationNotifications?: boolean }) => void
  onPlatform?: (next: { defaultView?: 'grid' | 'list'; terminalsEnabled?: boolean }) => void
  onToast: (message: string) => void
}) {
  const [nodeName, setNodeName] = useState(data.platform.nodeName)
  const [signInMessage, setSignInMessage] = useState(data.platform.signInMessage ?? '')
  const [defaultView, setDefaultView] = useState(data.platform.defaultView)
  const [operationNotifications, setOperationNotifications] = useState(data.account.operationNotifications !== false)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const user = await saveAccount({ operationNotifications })
      onAccount({
        name: user.name,
        email: user.email,
        virusScanEnabled: user.virusScanEnabled,
        operationNotifications: user.operationNotifications,
      })
      if (admin) await saveSettings({ platform: { nodeName, signInMessage, defaultView } })
      onPlatform?.({ defaultView })
      await onSaved()
      onToast('General settings saved')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <Heading title="General" hint="Everyday behavior and how this Storebase node presents itself." />
      <div className="space-y-4">
        <SettingsCard title="Operations" hint="Control feedback for file uploads, copies, scans, and other actions.">
          <Toggle on={operationNotifications} onChange={setOperationNotifications} label="Show operation notifications" />
        </SettingsCard>
        {admin ? (
          <SettingsCard title="Node identity" hint="Shown to everyone who signs in to this node.">
            <label className="mb-4 block text-sm text-[#8d8d8d]">
              Node name
              <Input className={`${fieldClass} mt-1.5`} value={nodeName} onChange={(event) => setNodeName(event.target.value)} />
            </label>
            <label className="block text-sm text-[#8d8d8d]">
              Sign-in note
              <Input className={`${fieldClass} mt-1.5`} value={signInMessage} onChange={(event) => setSignInMessage(event.target.value)} placeholder="Optional line under Sign in" />
            </label>
          </SettingsCard>
        ) : null}
        {admin ? (
          <SettingsCard title="File view" hint="Choose the initial layout for files and folders.">
            <div className="flex gap-2">
              {(['grid', 'list'] as const).map((view) => (
                <button key={view} type="button" onClick={() => setDefaultView(view)} className={cn('h-9 rounded-full px-4 text-sm capitalize', defaultView === view ? 'bg-white text-[#1a1a1a]' : 'bg-white/[0.08] text-[#e8e8e8]')}>
                  {view}
                </button>
              ))}
            </div>
          </SettingsCard>
        ) : null}
      </div>
      <Button className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function VirusPanel({
  data,
  admin,
  onSaved,
  onAccount,
  onToast,
}: {
  data: SettingsPayload
  admin: boolean
  onSaved: () => Promise<void>
  onAccount: (next: { name: string; email: string; virusScanEnabled?: boolean; operationNotifications?: boolean }) => void
  onToast: (message: string) => void
}) {
  const [virusScan, setVirusScan] = useState(data.account.virusScanEnabled === true)
  const [virusScanPolicy, setVirusScanPolicy] = useState(data.platform.virusScanPolicy ?? 'user')
  const [virusInstall, setVirusInstall] = useState(data.virusInstall)
  const [installingEngine, setInstallingEngine] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!admin) return
    void fetchVirusInstall().then(setVirusInstall).catch(() => {})
  }, [admin])

  useEffect(() => {
    if (virusInstall?.status !== 'installing') return
    const timer = window.setInterval(() => {
      void fetchVirusInstall()
        .then((next) => {
          setVirusInstall(next)
          if (next.status === 'done') onToast('ClamAV is ready')
          if (next.status === 'error') onToast(next.error ?? 'Could not install ClamAV')
        })
        .catch(() => {})
    }, 1500)
    return () => window.clearInterval(timer)
  }, [onToast, virusInstall?.status])

  async function startInstall() {
    setInstallingEngine(true)
    try {
      setVirusInstall(await installVirusEngine())
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not start the ClamAV install')
    } finally {
      setInstallingEngine(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      const user = await saveAccount({ virusScanEnabled: virusScan })
      onAccount({ name: user.name, email: user.email, virusScanEnabled: user.virusScanEnabled, operationNotifications: user.operationNotifications })
      if (admin) await saveSettings({ platform: { virusScanPolicy } })
      await onSaved()
      onToast('Virus settings saved')
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save virus settings')
    } finally {
      setBusy(false)
    }
  }

  const effectiveScan = virusScanPolicy === 'on' ? true : virusScanPolicy === 'off' ? false : virusScan

  return (
    <div className="max-w-2xl">
      <Heading title="Virus scanning" hint="Check uploads and existing files with ClamAV." />
      <div className="space-y-4">
        <SettingsCard title="Your uploads" hint="This preference applies when the administrator lets each user choose.">
          <Toggle on={effectiveScan} onChange={setVirusScan} label="Scan uploaded files for viruses" disabled={virusScanPolicy !== 'user'} />
          <p className="mt-1 text-xs text-[#8d8d8d]">
            {virusScanPolicy === 'on'
              ? 'Required by this node’s administrator.'
              : virusScanPolicy === 'off'
                ? 'Disabled by this node’s administrator.'
                : data.account.virusScannerAvailable === false
                  ? 'ClamAV is not installed yet. Files will remain marked as not scanned.'
                  : 'New uploads receive a safety rating after ClamAV checks them.'}
          </p>
        </SettingsCard>
        {admin ? (
          <SettingsCard title="Node policy" hint="Choose whether users control scanning or the node enforces it.">
            <div className="flex flex-wrap gap-2">
              {([['user', 'Let users choose'], ['on', 'Always on'], ['off', 'Always off']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setVirusScanPolicy(value)} className={cn('h-9 rounded-full px-4 text-sm', virusScanPolicy === value ? 'bg-white text-[#1a1a1a]' : 'bg-white/[0.08] text-[#e8e8e8]')}>
                  {label}
                </button>
              ))}
            </div>
          </SettingsCard>
        ) : null}
        {admin ? (
          <SettingsCard title="ClamAV engine" hint="Install and monitor the scanner used by this node.">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-[#e8e8e8]">
                  {virusInstall?.status === 'installing'
                    ? 'Installing ClamAV…'
                    : virusInstall?.status === 'error'
                      ? 'ClamAV is not ready'
                      : virusInstall?.status === 'done'
                        ? `ClamAV installed${virusInstall.engineVersion ? ` (${virusInstall.engineVersion})` : ''}`
                        : `ClamAV is not installed (about ${formatBytes(virusInstall?.estimateBytes ?? 480 * 1024 ** 2)}).`}
                </p>
                {virusInstall?.status === 'error' && virusInstall.error ? <p className="mt-1 text-xs text-[#e8a8a8]">{virusInstall.error}</p> : null}
              </div>
              <Button className="h-9 shrink-0 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={installingEngine || virusInstall?.status === 'installing' || virusInstall?.status === 'done'} onClick={() => void startInstall()}>
                {virusInstall?.status === 'done' ? 'Installed' : installingEngine || virusInstall?.status === 'installing' ? 'Installing…' : virusInstall?.status === 'error' ? 'Try again' : 'Install ClamAV'}
              </Button>
            </div>
            {virusInstall?.status === 'installing' ? (
              <div className="mt-4">
                <p className="mb-1 text-xs text-[#8d8d8d]">{virusInstall.step}</p>
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-[#6fbf73] transition-[width] duration-500" style={{ width: `${virusInstall.percent ?? 0}%` }} /></div>
              </div>
            ) : null}
          </SettingsCard>
        ) : null}
      </div>
      <Button className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
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
    <div className="max-w-3xl">
      <Heading title="Server" hint="Live process vs what the next restart will use." />
      <SettingsTable headings={['Runtime', 'Value']} minWidth={480}>
        {[
          ['Hostname', server.hostname],
          ['Listening now', `${server.liveHost}:${server.livePort}`],
          ['Data', server.dataDir],
          ['Drive', server.driveDir],
          ['Install', server.homeDir],
        ].map(([label, value]) => (
          <tr key={label}>
            <td className={`${tableCellClass} w-40 text-[#8d8d8d]`}>{label}</td>
            <td className={`${tableCellClass} break-all font-mono text-xs`}>{value}</td>
          </tr>
        ))}
      </SettingsTable>
      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_160px]">
        <label className="block text-sm text-[#8d8d8d]">
          Bind address
          <Input className={`${fieldClass} mt-1.5`} value={bindHost} onChange={(e) => setBindHost(e.target.value)} />
        </label>
        <label className="block text-sm text-[#8d8d8d]">
          Port
          <Input className={`${fieldClass} mt-1.5`} value={bindPort} onChange={(e) => setBindPort(e.target.value)} />
        </label>
      </div>
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

function DomainPanel({
  data,
  onSaved,
  onToast,
}: {
  data: SettingsPayload
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const [hostname, setHostname] = useState(data.domain?.hostname ?? '')
  const [info, setInfo] = useState<DomainInfo | null>(data.domain ?? null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setInfo(data.domain ?? null)
    if (data.domain?.hostname) setHostname(data.domain.hostname)
  }, [data.domain])

  useEffect(() => {
    if (info?.status !== 'waiting-dns' && info?.status !== 'issuing') return
    const id = window.setInterval(() => {
      void refreshDomain()
        .then(setInfo)
        .catch(() => {})
    }, 4000)
    return () => window.clearInterval(id)
  }, [info?.status])

  async function save() {
    setBusy(true)
    try {
      const next = await saveDomain(hostname)
      setInfo(next)
      await onSaved()
      onToast('Saved. Add the DNS records below, then wait — SSL issues itself.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save domain')
    } finally {
      setBusy(false)
    }
  }

  async function check() {
    setBusy(true)
    try {
      setInfo(await refreshDomain())
      await onSaved()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not refresh DNS')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      setInfo(await clearDomain())
      setHostname('')
      await onSaved()
      onToast('Domain removed. Site is back on the node port.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not remove domain')
    } finally {
      setBusy(false)
    }
  }

  const status = info?.status ?? 'idle'
  const statusText =
    status === 'active'
      ? 'Live with HTTPS'
      : status === 'issuing'
        ? info?.port80Owner === 'caddy'
          ? 'Waiting for Caddy HTTPS'
          : 'Getting a Let’s Encrypt certificate'
        : status === 'waiting-dns'
          ? 'Waiting for DNS'
          : status === 'error'
            ? 'Needs attention'
            : 'Not set'
  const proxy = info?.httpMode === 'proxy'
  const ownerLabel =
    info?.port80Owner === 'nginx'
      ? 'nginx'
      : info?.port80Owner === 'caddy'
        ? 'Caddy'
        : info?.port80Owner === 'apache'
          ? 'Apache'
          : null

  return (
    <div className="max-w-lg">
      <Heading
        title="Domain"
        hint="Point a hostname you own at this node. Storebase watches DNS, then mints a Let’s Encrypt cert. If nginx already owns 80/443, keep it and proxy to this node."
      />
      <label className="mb-4 block text-sm text-[#8d8d8d]">
        Hostname
        <Input
          className={`${fieldClass} mt-1.5`}
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="drive.example.com"
        />
      </label>
      <div className="mb-6 flex flex-wrap gap-2">
        <Button className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Use this domain'}
        </Button>
        {info?.hostname ? (
          <>
            <Button
              variant="outline"
              className="h-11 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              disabled={busy}
              onClick={() => void check()}
            >
              Recheck DNS
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-full border-white/20 bg-transparent text-[#f28b82] hover:bg-white/10 hover:text-[#f28b82]"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </>
        ) : null}
      </div>

      <p className="mb-1 text-sm text-white">{statusText}</p>
      {info?.httpsUrl ? (
        <a href={info.httpsUrl} className="mb-4 block text-sm text-white underline decoration-white/30 underline-offset-4">
          {info.httpsUrl}
        </a>
      ) : (
        <p className={`mb-4 text-sm ${status === 'error' ? 'text-[#f28b82]' : 'text-[#8d8d8d]'}`}>
          {info?.error ?? 'Save a hostname to get the records your DNS host needs.'}
        </p>
      )}
      {info?.error && info.status !== 'idle' && info.httpsUrl ? (
        <p className="mb-4 text-sm text-[#f28b82]">{info.error}</p>
      ) : null}

      {info?.records.length ? (
        <>
          <p className="mb-2 text-sm text-[#8d8d8d]">DNS records</p>
          <div className="mb-4 overflow-hidden rounded-xl bg-[#242424]">
            {info.records.map((record) => (
              <div key={`${record.type}-${record.host}`} className="border-b border-white/5 px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-[#8d8d8d]">
                      {record.type} · TTL {record.ttl}
                    </p>
                    <p className="truncate text-sm text-white">{record.host}</p>
                    <p className="break-all font-mono text-sm text-[#e8e8e8]">{record.value}</p>
                  </div>
                  <Button
                    variant="outline"
                    className="h-8 shrink-0 rounded-full border-white/20 bg-transparent px-3 text-xs text-white hover:bg-white/10 hover:text-white"
                    onClick={() =>
                      void copyText(record.value).then((ok) => onToast(ok ? `Copied ${record.type}` : 'Could not copy'))
                    }
                  >
                    Copy
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <p className="text-xs leading-5 text-[#8d8d8d]">
        At your registrar, create those records with DNS only — not a Cloudflare orange-cloud proxy. Leave the node port
        ({data.server?.livePort ?? 4780}) open for LAN/Mac pairing if you still want it.
      </p>
      {proxy && info ? (
        <div className="mt-5">
          <p className="mb-1 text-sm text-white">
            {ownerLabel ? `${ownerLabel} already has port 80` : 'Something else already has port 80'}
          </p>
          <p className="mb-4 text-xs leading-5 text-[#8d8d8d]">
            {info.port80Owner === 'caddy'
              ? 'Keep Caddy. Paste this site block and reload — Caddy will terminate TLS and reverse-proxy Storebase. Don’t stop it.'
              : 'Keep nginx. Paste the site below so ACME and HTTPS hit Storebase on the node port, then reload. Don’t stop it.'}
          </p>
          {info.port80Owner === 'caddy' ? (
            <ConfigBlock
              title="Caddyfile"
              value={info.configs?.caddy ?? ''}
              onToast={onToast}
            />
          ) : (
            <>
              <ConfigBlock title="nginx" value={info.configs?.nginx ?? ''} onToast={onToast} />
              <ConfigBlock title="Apache" value={info.configs?.apache ?? ''} onToast={onToast} />
              <ConfigBlock title="Caddyfile" value={info.configs?.caddy ?? ''} onToast={onToast} />
            </>
          )}
        </div>
      ) : null}
      {info && !info.httpBound && !proxy && info.hostname ? (
        <p className="mt-3 text-sm text-[#e8c07d]">
          Port 80 is not bound yet. Run the node as root, or give it cap_net_bind_service, so ACME can answer.
        </p>
      ) : null}
    </div>
  )
}

function ConfigBlock({
  title,
  value,
  onToast,
}: {
  title: string
  value: string
  onToast: (message: string) => void
}) {
  if (!value) return null
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm text-[#8d8d8d]">{title}</p>
        <Button
          variant="outline"
          className="h-8 shrink-0 rounded-full border-white/20 bg-transparent px-3 text-xs text-white hover:bg-white/10 hover:text-white"
          onClick={() => void copyText(value).then((ok) => onToast(ok ? `Copied ${title}` : 'Could not copy'))}
        >
          Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-[#242424] p-4 font-mono text-xs leading-5 text-[#e8e8e8]">{value}</pre>
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
    <div className="max-w-4xl">
      <Heading title="Storage" hint="Node-wide reserve. Admins set per-user caps under Users." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <MetricCard label="Reserved" value={`${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`} />
        <MetricCard label="Used" value={formatBytes(storage.poolUsedBytes)} />
        <MetricCard label="Free on disk" value={formatBytes(storage.disk.freeBytes)} />
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
      {users.length ? (
        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-white">Usage by user</p>
          <SettingsTable headings={['User', 'Role', 'Used', 'Limit']} minWidth={560}>
            {users.map((user) => (
              <tr key={user.id}>
                <td className={`${tableCellClass} font-medium text-white`}>{user.name}</td>
                <td className={`${tableCellClass} capitalize text-[#8d8d8d]`}>{user.role}</td>
                <td className={`${tableCellClass} tabular-nums`}>{formatBytes(user.usedBytes)}</td>
                <td className={`${tableCellClass} tabular-nums text-[#8d8d8d]`}>
                  {user.quotaBytes ? formatBytes(user.quotaBytes) : 'Node default'}
                </td>
              </tr>
            ))}
          </SettingsTable>
        </div>
      ) : null}
      <Button className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save cap'}
      </Button>
      <NetworkStores data={data} onSaved={onSaved} onToast={onToast} />
    </div>
  )
}

function NetworkStores({
  data,
  onSaved,
  onToast,
}: {
  data: SettingsPayload
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const storage = data.storage
  const backends = storage?.backends ?? []
  const [mode, setMode] = useState<null | 'b2' | 's3' | 'node'>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [capacityGb, setCapacityGb] = useState('1000')
  const [endpoint, setEndpoint] = useState('')
  const [region, setRegion] = useState('')
  const [bucket, setBucket] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [lostKey, setLostKey] = useState(false)
  const [preferFirst, setPreferFirst] = useState(true)
  const [reconnect, setReconnect] = useState<{ id: string; type: 's3' | 'node'; accessKey?: string } | null>(null)
  const [reconnectKey, setReconnectKey] = useState('')
  const [reconnectSecret, setReconnectSecret] = useState('')

  if (!storage) return null
  const pool = storage.poolBytes ?? storage.reservedBytes
  const ready =
    mode === 'node'
      ? Boolean(url.trim() && token.trim())
      : Boolean(bucket.trim() && endpoint.trim() && accessKey.trim() && secretKey.trim())
  const stores = (storage.order?.length ? storage.order : ['local', ...backends.map((backend) => backend.id)])
    .map((id) => {
      if (id === 'local') {
        return {
          id: 'local',
          name: 'This disk',
          detail: 'Node reserve on this machine',
          usedBytes: storage.localUsedBytes ?? 0,
          capacityBytes: storage.reservedBytes,
        }
      }
      const backend = backends.find((item) => item.id === id)
      if (!backend) return null
      return {
        id: backend.id,
        name: backend.name,
        detail: backend.type === 's3' ? backend.bucket || backend.endpoint || '' : backend.url || '',
        usedBytes: backend.usedBytes,
        capacityBytes: backend.capacityBytes,
        remote: backend,
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))

  function reset() {
    setMode(null)
    setName('')
    setCapacityGb('1000')
    setEndpoint('')
    setRegion('')
    setBucket('')
    setAccessKey('')
    setSecretKey('')
    setUrl('')
    setToken('')
    setLostKey(false)
    setPreferFirst(true)
  }

  async function add() {
    setBusy(true)
    const first = preferFirst
    try {
      await addStorageBackend(
        mode === 'node'
          ? {
              type: 'node',
              name: name.trim() || 'Storebase node',
              capacityGb: Number(capacityGb) || 1000,
              url,
              token,
              first,
            }
          : {
              type: 's3',
              name: name.trim() || (mode === 'b2' ? bucket.trim() || 'Backblaze' : bucket.trim() || 'S3'),
              capacityGb: Number(capacityGb) || 1000,
              endpoint,
              region,
              bucket,
              accessKey,
              secretKey,
              first,
            },
      )
      reset()
      await onSaved()
      onToast(first ? 'Connected. New files go here first, then the next store when it’s full.' : 'Connected. Move it up if you want it before this disk.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not connect')
    } finally {
      setBusy(false)
    }
  }

  async function moveStore(id: string, dir: -1 | 1) {
    const ids = stores.map((row) => row.id)
    const index = ids.indexOf(id)
    const next = index + dir
    if (index < 0 || next < 0 || next >= ids.length) return
    ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
    try {
      await setStoreOrder(ids)
      await onSaved()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not reorder')
    }
  }

  return (
    <div className="mt-12">
      <Heading
        title="Network"
        hint="New files use the first store with room. Move Backblaze above this disk if you want B2 first."
      />
      <p className="mb-6 text-sm text-[#8d8d8d]">
        Pool {formatBytes(storage.poolUsedBytes)} of {formatBytes(pool)}
      </p>

      {backends.length > 0 ? (
        <div className="mb-6 space-y-3">
          {stores.map((row, index) => (
            <div key={row.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm text-white">
                  <span className="mr-2 text-[#8d8d8d]">{index === 0 ? 'First' : 'Then'}</span>
                  {row.name}
                </div>
                <div className="text-xs text-[#8d8d8d]">
                  {row.detail} · {formatBytes(row.usedBytes)} / {formatBytes(row.capacityBytes)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`Move ${row.name} up`}
                  className="text-[#8d8d8d] hover:text-white disabled:opacity-30"
                  disabled={index === 0}
                  onClick={() => void moveStore(row.id, -1)}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.name} down`}
                  className="text-[#8d8d8d] hover:text-white disabled:opacity-30"
                  disabled={index === stores.length - 1}
                  onClick={() => void moveStore(row.id, 1)}
                >
                  <ChevronDown className="size-4" />
                </button>
                {row.remote ? (
                  <>
                    <button
                      type="button"
                      className="text-xs text-[#8d8d8d] hover:text-white"
                      onClick={() => {
                        void testStorageBackend(row.remote!.id)
                          .then(() => onToast(`${row.name} is reachable`))
                          .catch((err) => onToast(err instanceof Error ? err.message : 'Unreachable'))
                      }}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      className="text-xs text-[#8d8d8d] hover:text-white"
                      onClick={() => {
                        setReconnect({ id: row.remote!.id, type: row.remote!.type, accessKey: row.remote!.accessKey })
                        setReconnectKey(row.remote!.accessKey ?? '')
                        setReconnectSecret('')
                      }}
                    >
                      Reconnect
                    </button>
                    <button
                      type="button"
                      className="text-xs text-[#8d8d8d] hover:text-[#f28b82]"
                      onClick={() => {
                        void deleteStorageBackend(row.remote!.id)
                          .then(async () => {
                            await onSaved()
                            onToast(`Removed ${row.name}`)
                          })
                          .catch((err) => onToast(err instanceof Error ? err.message : 'Could not remove'))
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {reconnect ? (
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <div className="mb-3 text-sm text-white">Reconnect store</div>
              <p className="mb-3 text-xs text-[#8d8d8d]">
                This keeps every existing file pointer. For Backblaze, create a Read and Write application key.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                {reconnect.type === 's3' ? (
                  <>
                    <Field label="keyID">
                      <Input className={fieldClass} value={reconnectKey} onChange={(event) => setReconnectKey(event.target.value)} />
                    </Field>
                    <Field label="applicationKey">
                      <Input className={fieldClass} type="password" value={reconnectSecret} onChange={(event) => setReconnectSecret(event.target.value)} />
                    </Field>
                  </>
                ) : (
                  <Field label="Inbound token">
                    <Input className={fieldClass} value={reconnectSecret} onChange={(event) => setReconnectSecret(event.target.value)} />
                  </Field>
                )}
                <Button
                  className="rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
                  disabled={busy || !reconnectSecret.trim() || (reconnect.type === 's3' && !reconnectKey.trim())}
                  onClick={() => {
                    setBusy(true)
                    void reconnectStorageBackend(
                      reconnect.id,
                      reconnect.type === 's3'
                        ? { accessKey: reconnectKey, secretKey: reconnectSecret }
                        : { token: reconnectSecret },
                    )
                      .then(async () => {
                        setReconnect(null)
                        setReconnectSecret('')
                        await onSaved()
                        onToast('Store reconnected. Existing files are available again.')
                      })
                      .catch((err) => onToast(err instanceof Error ? err.message : 'Could not reconnect'))
                      .finally(() => setBusy(false))
                  }}
                >
                  {busy ? 'Checking…' : 'Save and test'}
                </Button>
                <Button variant="ghost" className="rounded-full" onClick={() => setReconnect(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode ? (
        <div className="mb-10 space-y-4">
          {mode === 'b2' ? (
            <>
              <section className="rounded-2xl bg-white/[0.04] px-4 py-3">
                <div className="mb-1 text-[11px] text-[#8d8d8d] uppercase">B2 Cloud Storage → Buckets</div>
                <p className="mb-3 text-xs text-[#8d8d8d]">The Storebase card. Not Caps & Alerts, Fireball, or Cloud Replication.</p>
                <div className="space-y-3">
                  <Field label="Bucket name" hint="The title. Not Bucket ID.">
                    <Input className={fieldClass} placeholder="Storebase" value={bucket} onChange={(e) => setBucket(e.target.value)} />
                  </Field>
                  <Field label="Endpoint" hint="s3.us-east-005.backblazeb2.com — https optional.">
                    <Input
                      className={fieldClass}
                      placeholder="s3.us-east-005.backblazeb2.com"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                    />
                  </Field>
                </div>
              </section>
              <section className="rounded-2xl bg-white/[0.04] px-4 py-3">
                <div className="mb-1 text-[11px] text-[#8d8d8d] uppercase">App Keys → Your Application Keys</div>
                <p className="mb-3 text-xs text-[#8d8d8d]">The Storebase row. Skip Master Application Key.</p>
                <div className="space-y-3">
                  <Field label="keyID" hint="Starts with 005. Not the short Master keyID.">
                    <Input className={fieldClass} placeholder="005…" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
                  </Field>
                  <Field label="applicationKey" hint="Shown once. Not keyID.">
                    <Input
                      className={fieldClass}
                      type="password"
                      placeholder="Shown only once"
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value)}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="mt-3 text-xs text-[#8d8d8d] hover:text-white"
                  onClick={() => setLostKey((on) => !on)}
                >
                  {lostKey ? 'Hide' : 'I only have a keyID'}
                </button>
                {lostKey ? (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[#8d8d8d]">
                    <li>Add a New Application Key. Name it Storebase.</li>
                    <li>Choose Read and Write access for this bucket (or all buckets).</li>
                    <li>Copy applicationKey immediately. Backblaze never shows it again.</li>
                    <li>Paste that new keyID + applicationKey here.</li>
                  </ol>
                ) : null}
              </section>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Cap">
                  <div className="flex items-center gap-2">
                    <Input className={`${fieldClass} w-24`} value={capacityGb} onChange={(e) => setCapacityGb(e.target.value)} />
                    <span className="text-sm text-[#8d8d8d]">GB</span>
                  </div>
                </Field>
              </div>
            </>
          ) : mode === 's3' ? (
            <>
              <Field label="Name">
                <Input className={fieldClass} placeholder="R2" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Bucket">
                <Input className={fieldClass} value={bucket} onChange={(e) => setBucket(e.target.value)} />
              </Field>
              <Field label="Endpoint">
                <Input className={fieldClass} placeholder="https://…" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
              </Field>
              <Field label="Region">
                <Input className={fieldClass} placeholder="auto" value={region} onChange={(e) => setRegion(e.target.value)} />
              </Field>
              <Field label="Access key">
                <Input className={fieldClass} value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
              </Field>
              <Field label="Secret">
                <Input className={fieldClass} type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
              </Field>
              <Field label="Cap">
                <div className="flex items-center gap-2">
                  <Input className={`${fieldClass} w-28`} value={capacityGb} onChange={(e) => setCapacityGb(e.target.value)} />
                  <span className="text-sm text-[#8d8d8d]">GB</span>
                </div>
              </Field>
            </>
          ) : (
            <>
              <Field label="Name">
                <Input className={fieldClass} placeholder="Office node" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Node URL" hint="The other Storebase, not 0.0.0.0.">
                <Input className={fieldClass} placeholder="http://72.61.3.42:4780" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Field label="Inbound token" hint="On that node: Settings → Storage → Network → Copy.">
                <Input className={fieldClass} value={token} onChange={(e) => setToken(e.target.value)} />
              </Field>
              <Field label="Cap">
                <div className="flex items-center gap-2">
                  <Input className={`${fieldClass} w-28`} value={capacityGb} onChange={(e) => setCapacityGb(e.target.value)} />
                  <span className="text-sm text-[#8d8d8d]">GB</span>
                </div>
              </Field>
            </>
          )}
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-[#e8e8e8]">Fill this before this disk</span>
            <button
              type="button"
              role="switch"
              aria-checked={preferFirst}
              className="shrink-0"
              onClick={() => setPreferFirst((on) => !on)}
            >
              <span className={preferFirst ? 'relative block h-6 w-11 rounded-full bg-white' : 'relative block h-6 w-11 rounded-full bg-white/20'}>
                <span
                  className={
                    preferFirst
                      ? 'absolute top-0.5 left-5 size-5 rounded-full bg-[#1a1a1a]'
                      : 'absolute top-0.5 left-0.5 size-5 rounded-full bg-white'
                  }
                />
              </span>
            </button>
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" className="rounded-full" onClick={reset}>
              Cancel
            </Button>
            <Button
              className="rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
              disabled={busy || !ready}
              onClick={() => void add()}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-10">
          <div className="mb-4 rounded-2xl bg-white/[0.04] px-4 py-4">
            <div className="text-sm text-white">Connect Backblaze</div>
            <p className="mt-1 text-xs text-[#8d8d8d]">
              Open B2 Cloud Storage → Buckets, then App Keys. You need four values. That’s it.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-[#8d8d8d]">
              <li>Bucket name — the title on the card (Storebase), not Bucket ID.</li>
              <li>Endpoint — s3.us-east-005.backblazeb2.com, from that same card.</li>
              <li>keyID — Your Application Keys → Storebase, with Read and Write access.</li>
              <li>applicationKey — the secret Backblaze showed once. If you lost it, create a new key.</li>
            </ol>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
              onClick={() => {
                setPreferFirst(true)
                setMode('b2')
              }}
            >
              I have those four
            </Button>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setPreferFirst(false)
                setMode('s3')
              }}
            >
              Other S3
            </Button>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setPreferFirst(false)
                setMode('node')
              }}
            >
              Another Storebase
            </Button>
          </div>
        </div>
      )}

      <div className="mb-8 rounded-2xl bg-white/[0.04] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-white">Let other nodes store here</div>
            <div className="text-xs text-[#8d8d8d]">They paste this token when they add this node.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={storage.inboundEnabled !== false}
            className="shrink-0"
            onClick={() => {
              void (async () => {
                try {
                  await setNetworkInbound(storage.inboundEnabled === false)
                  await onSaved()
                } catch (err) {
                  onToast(err instanceof Error ? err.message : 'Could not update')
                }
              })()
            }}
          >
            <span
              className={
                storage.inboundEnabled !== false
                  ? 'relative block h-6 w-11 rounded-full bg-white'
                  : 'relative block h-6 w-11 rounded-full bg-white/20'
              }
            >
              <span
                className={
                  storage.inboundEnabled !== false
                    ? 'absolute top-0.5 left-5 size-5 rounded-full bg-[#1a1a1a]'
                    : 'absolute top-0.5 left-0.5 size-5 rounded-full bg-white'
                }
              />
            </span>
          </button>
        </div>
        {storage.inboundEnabled !== false && storage.inboundToken ? (
          <div className="mt-3 flex gap-2">
            <Input readOnly className={fieldClass} value={storage.inboundToken} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="ghost"
              className="h-11 rounded-full"
              onClick={() => {
                void copyText(storage.inboundToken ?? '').then((ok) => onToast(ok ? 'Token copied' : 'Copy failed'))
              }}
            >
              Copy
            </Button>
            <Button
              variant="ghost"
              className="h-11 rounded-full"
              onClick={() => {
                void (async () => {
                  try {
                    await rotateNetworkToken()
                    await onSaved()
                    onToast('Token rotated. Update any node that used the old one.')
                  } catch (err) {
                    onToast(err instanceof Error ? err.message : 'Could not rotate')
                  }
                })()
              }}
            >
              Rotate
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-[#e8e8e8]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[#8d8d8d]">{hint}</span> : null}
    </label>
  )
}

function UsersPanel({
  meId,
  users,
  nodeGb,
  onSaved,
  onToast,
}: {
  meId: string
  users: SettingsUser[]
  nodeGb: number
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [quotaGb, setQuotaGb] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      const gb = quotaGb.trim() ? Number(quotaGb) : null
      await createUser({ name, email, password, role, quotaGb: gb })
      setName('')
      setEmail('')
      setPassword('')
      setQuotaGb('')
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
    <div className="max-w-5xl">
      <Heading title="Users" hint="Each account gets its own drive. Set a GB cap per person, or leave blank for the node default." />
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
        <Input
          className={fieldClass}
          placeholder={`Storage GB (blank = node ${nodeGb ? Math.round(nodeGb * 10) / 10 : ''} GB)`}
          inputMode="decimal"
          value={quotaGb}
          onChange={(e) => setQuotaGb(e.target.value)}
        />
        <div className="flex gap-2 sm:col-span-2">
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

      <SettingsTable headings={['User', 'Role', 'Storage', 'Quota', 'Created', 'Actions']} minWidth={1_020}>
        {users.map((user) => (
          <tr key={user.id}>
            <td className={tableCellClass}>
              <div className="font-medium text-white">
                {user.name}
                {user.id === meId ? <span className="text-[#8d8d8d]"> · you</span> : null}
              </div>
              <div className="mt-0.5 text-xs text-[#8d8d8d]">{user.email}</div>
            </td>
            <td className={tableCellClass}>
              <span className="rounded-full bg-white/[0.07] px-2 py-1 text-[11px] font-medium text-[#bdbdbd] capitalize">
                {user.role}
              </span>
            </td>
            <td className={`${tableCellClass} tabular-nums`}>{formatBytes(user.usedBytes)}</td>
            <td className={tableCellClass}>
              <QuotaField user={user} nodeGb={nodeGb} onSaved={onSaved} onToast={onToast} />
            </td>
            <td className={`${tableCellClass} whitespace-nowrap text-[#8d8d8d]`}>
              {user.createdAt ? formatDate(user.createdAt) : '—'}
            </td>
            <td className={tableCellClass}>
              <div className="flex gap-1 whitespace-nowrap">
                <Button
                  variant="ghost"
                  className="h-8 rounded-full px-3"
                  onClick={() => void setRoleFor(user, user.role === 'admin' ? 'user' : 'admin')}
                >
                  {user.role === 'admin' ? 'Make user' : 'Make admin'}
                </Button>
                <Button variant="ghost" className="h-8 rounded-full px-3" onClick={() => void resetPassword(user)}>
                  Password
                </Button>
                {user.id !== meId ? (
                  <Button variant="ghost" className="h-8 rounded-full px-3 text-[#f28b82]" onClick={() => void remove(user)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </SettingsTable>
    </div>
  )
}

function QuotaField({
  user,
  nodeGb,
  onSaved,
  onToast,
}: {
  user: SettingsUser
  nodeGb: number
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const asGb = (bytes: number | null) => (bytes != null ? String(Math.round((bytes / 1024 ** 3) * 10) / 10) : '')
  const [value, setValue] = useState(asGb(user.quotaBytes))
  useEffect(() => {
    setValue(asGb(user.quotaBytes))
  }, [user.quotaBytes])

  async function save() {
    const trimmed = value.trim()
    try {
      await patchUser(user.id, { quotaGb: trimmed === '' ? null : Number(trimmed) })
      await onSaved()
      onToast(trimmed === '' ? `${user.name} uses the node default (${Math.round(nodeGb * 10) / 10} GB)` : `${user.name} capped at ${trimmed} GB`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not set quota')
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-8 w-24 rounded-full border-0 bg-[#242424] px-3 text-xs text-white"
        placeholder="GB"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />
      <Button variant="ghost" className="h-8 rounded-full" onClick={() => void save()}>
        Cap
      </Button>
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

function timingTone(ms: number) {
  if (ms >= 1_000) return 'text-[#f28b82]'
  if (ms >= 250) return 'text-[#e8c07d]'
  return 'text-[#81c995]'
}

function formatTiming(ms: number) {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(2)} s` : `${Math.round(ms)} ms`
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function DiagnosticsPanel({
  data,
  onSaved,
  onToast,
}: {
  data?: DiagnosticsPayload
  onSaved: () => Promise<void>
  onToast: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  if (!data) return null

  async function refresh() {
    setBusy(true)
    try {
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    const ok = await copyText(JSON.stringify(data, null, 2))
    onToast(ok ? 'Diagnostics copied' : 'Could not copy diagnostics')
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <Heading title="Diagnostics" hint="Server-side request timings reveal which phase is slow without adding work to the browser." />
        <div className="flex gap-2">
          <Button variant="ghost" className="h-9 rounded-full" onClick={() => void copy()}>Copy report</Button>
          <Button className="h-9 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Server uptime" value={formatUptime(data.process.uptimeSeconds)} detail={data.process.nodeVersion} />
        <MetricCard label="Process memory" value={formatBytes(data.process.rssBytes)} detail={`${formatBytes(data.process.heapUsedBytes)} heap used`} />
        <MetricCard label="Size cache" value={`${data.cache.sizeEntries ?? 0} entries`} detail={`${data.cache.activeRefreshes ?? 0} active · ${data.cache.queuedRefreshes ?? 0} queued`} />
        <MetricCard label="Reservations" value={formatBytes(data.cache.reservedBytes ?? 0)} detail={`${data.cache.activeReservations ?? 0} active operations`} />
      </div>

      <SettingsCard title="Settings load breakdown" hint="Base is account and platform data. Detail is the selected section. Red values are over one second.">
        {data.settings.length ? (
          <SettingsTable headings={['Section', 'Base', 'Section data', 'Total', 'Captured']} minWidth={650}>
            {data.settings.slice(0, 12).map((timing, index) => (
              <tr key={`${timing.at}-${index}`}>
                <td className={`${tableCellClass} font-medium text-white capitalize`}>{timing.section}</td>
                <td className={`${tableCellClass} tabular-nums ${timingTone(timing.baseMs)}`}>{formatTiming(timing.baseMs)}</td>
                <td className={`${tableCellClass} tabular-nums ${timingTone(timing.detailMs)}`}>{formatTiming(timing.detailMs)}</td>
                <td className={`${tableCellClass} tabular-nums ${timingTone(timing.totalMs)}`}>{formatTiming(timing.totalMs)}</td>
                <td className={`${tableCellClass} whitespace-nowrap text-[#8d8d8d]`}>{formatDate(timing.at)}</td>
              </tr>
            ))}
          </SettingsTable>
        ) : (
          <p className="text-sm text-[#8d8d8d]">Open a few settings sections, then refresh this page to compare their timings.</p>
        )}
      </SettingsCard>

      <div className="mt-4">
        <SettingsCard title="Slowest API routes" hint="Rolling measurements from this server process, sorted by the 95th-percentile response time.">
          {data.endpoints.length ? (
            <SettingsTable headings={['Route', 'Samples', 'Average', 'P95', 'Maximum', 'Errors']} minWidth={760}>
              {data.endpoints.slice(0, 16).map((endpoint) => (
                <tr key={endpoint.path}>
                  <td className={`${tableCellClass} font-mono text-xs text-white`}>{endpoint.path}</td>
                  <td className={`${tableCellClass} tabular-nums text-[#8d8d8d]`}>{endpoint.count}</td>
                  <td className={`${tableCellClass} tabular-nums ${timingTone(endpoint.averageMs)}`}>{formatTiming(endpoint.averageMs)}</td>
                  <td className={`${tableCellClass} tabular-nums ${timingTone(endpoint.p95Ms)}`}>{formatTiming(endpoint.p95Ms)}</td>
                  <td className={`${tableCellClass} tabular-nums ${timingTone(endpoint.maxMs)}`}>{formatTiming(endpoint.maxMs)}</td>
                  <td className={`${tableCellClass} tabular-nums ${endpoint.errors ? 'text-[#f28b82]' : 'text-[#8d8d8d]'}`}>{endpoint.errors}</td>
                </tr>
              ))}
            </SettingsTable>
          ) : (
            <p className="text-sm text-[#8d8d8d]">No requests have been measured yet.</p>
          )}
        </SettingsCard>
      </div>
      <p className="mt-3 text-xs text-[#777]">Captured {formatDate(data.generatedAt)} · {data.process.platform} · {data.process.cpuCount} CPU cores</p>
    </div>
  )
}
