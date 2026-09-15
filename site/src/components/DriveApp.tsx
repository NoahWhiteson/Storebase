import { FileGlyph } from '@/components/FileGlyph'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DriveItem, FileKind, SectionId } from '@/types'
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  FileSpreadsheet,
  FileText,
  FolderPlus,
  Globe,
  Grid2x2,
  HardDrive,
  Home,
  KeyRound,
  Laptop,
  List,
  Menu,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  SquareTerminal,
  Star,
  Timer,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'

const titles: Record<SectionId, string> = {
  home: 'Home',
  'my-drive': 'My files',
  shared: 'Shared with me',
  recent: 'Recent',
  starred: 'Starred',
  temp: 'Temp',
  spam: 'Spam',
  trash: 'Trash',
}

const nav: { id: SectionId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'my-drive', label: 'My files', icon: HardDrive },
  { id: 'shared', label: 'Shared with me', icon: Users },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'temp', label: 'Temp', icon: Timer },
  { id: 'spam', label: 'Spam', icon: AlertTriangle },
  { id: 'trash', label: 'Trash', icon: Trash2 },
]

const account = { name: 'Noah Whiteson', email: 'noah@home-node', initials: 'NW' }
const quotaBytes = 500 * 1024 ** 3
const usedBytes = 186 * 1024 ** 3

function item(
  id: string,
  name: string,
  kind: FileKind,
  size: number | null,
  extra: Partial<DriveItem> = {},
): DriveItem {
  return {
    id,
    name,
    kind,
    owner: account.name,
    modifiedAt: '2026-09-12T18:04:00.000Z',
    size,
    starred: false,
    shared: false,
    ...extra,
  }
}

const files: Record<SectionId, DriveItem[]> = {
  home: [
    item('downloads', 'Downloads', 'folder', null),
    item('photos', 'Photos', 'folder', null, { starred: true }),
    item('notes', 'Q3 notes.md', 'doc', 18432, { modifiedAt: '2026-09-14T11:20:00.000Z' }),
    item('cabin', 'Cabin.jpg', 'image', 4_200_000, { starred: true }),
    item('budget', 'Budget.xlsx', 'sheet', 88200),
    item('deck', 'All-hands.pdf', 'pdf', 2_400_000, { shared: true }),
    item('clip', 'Capture.mp4', 'video', 84_000_000),
    item('zip', 'Export.zip', 'zip', 12_400_000),
  ],
  'my-drive': [
    item('downloads', 'Downloads', 'folder', null),
    item('photos', 'Photos', 'folder', null, { starred: true }),
    item('desktop', 'Desktop', 'folder', null),
    item('notes', 'Q3 notes.md', 'doc', 18432),
    item('cabin', 'Cabin.jpg', 'image', 4_200_000, { starred: true }),
    item('budget', 'Budget.xlsx', 'sheet', 88200),
    item('deck', 'All-hands.pdf', 'pdf', 2_400_000, { shared: true }),
    item('slides', 'Kickoff.pptx', 'slide', 6_100_000),
  ],
  shared: [
    item('share-1', 'Brand kit', 'folder', null, { owner: 'Maya Chen' }),
    item('share-2', 'Contract.pdf', 'pdf', 540_000, { shared: true }),
  ],
  recent: [
    item('notes', 'Q3 notes.md', 'doc', 18432, { modifiedAt: '2026-09-14T11:20:00.000Z' }),
    item('cabin', 'Cabin.jpg', 'image', 4_200_000),
    item('clip', 'Capture.mp4', 'video', 84_000_000),
  ],
  starred: [
    item('photos', 'Photos', 'folder', null, { starred: true }),
    item('cabin', 'Cabin.jpg', 'image', 4_200_000, { starred: true }),
  ],
  temp: [
    item('dmg', 'Storebase.dmg', 'zip', 48_000_000, { expiresAt: '2026-09-16T12:00:00.000Z' }),
    item('iso', 'ubuntu.iso', 'zip', 1_600_000_000, { expiresAt: '2026-09-18T08:00:00.000Z' }),
  ],
  spam: [],
  trash: [item('old', 'Old scan.pdf', 'pdf', 220_000, { modifiedAt: '2026-08-20T09:00:00.000Z' })],
}

type Pane = 'files' | 'settings' | 'terminals'

export function DriveApp() {
  const [section, setSection] = useState<SectionId>('home')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<string | null>('cabin')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('files')
  const [settingsSection, setSettingsSection] = useState('account')

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = files[section]
    if (!q) return list
    return list.filter((entry) => entry.name.toLowerCase().includes(q))
  }, [section, search])

  function go(id: SectionId) {
    setSection(id)
    setPane('files')
    setMobileOpen(false)
    setSelected(null)
  }

  return (
    <div className="flex h-full min-h-[540px] flex-col overflow-hidden bg-[#1a1a1a] text-[#e8e8e8]">
      <header className="flex h-16 shrink-0 items-center bg-[#1a1a1a]">
        <div className="flex h-full w-auto shrink-0 items-center gap-2 px-3 md:w-[256px] md:gap-2.5 md:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          <StorebaseLogo className="size-8" />
          <span className="text-[20px] font-medium tracking-tight text-white">Storebase</span>
        </div>
        <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 md:gap-3 md:pr-4 md:pl-2">
          {pane === 'settings' ? (
            <div className="min-w-0 flex-1 text-[15px] font-medium text-white">Settings</div>
          ) : pane === 'terminals' ? (
            <div className="min-w-0 flex-1 text-[15px] font-medium text-white">Terminal</div>
          ) : (
            <div className="relative flex h-12 min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-4 size-[18px] text-[#9a9a9a]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search in Storebase"
                className="h-12 rounded-full border-0 bg-[#242424] pl-12 text-[15px] shadow-none placeholder:text-[#8d8d8d] outline-none focus-visible:bg-[#2a2a2a] focus-visible:ring-0"
              />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={view === 'grid' ? 'List view' : 'Grid view'}
                  onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
                >
                  {view === 'grid' ? <List /> : <Grid2x2 />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{view === 'grid' ? 'List view' : 'Grid view'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('size-10', pane === 'terminals' ? 'bg-white/10' : '')}
                  aria-label="Terminal"
                  onClick={() => setPane('terminals')}
                >
                  <SquareTerminal />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Terminal</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label="Settings"
                  onClick={() => setPane('settings')}
                >
                  <Settings />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-white/30">
                  <Avatar>
                    <AvatarFallback className="bg-[#2a2a2a] text-sm font-medium text-white">
                      {account.initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  {account.name}
                  <div className="font-normal text-muted-foreground">{account.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setSettingsSection('account')
                    setPane('settings')
                  }}
                >
                  Account
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setSettingsSection('storage')
                    setPane('settings')
                  }}
                >
                  Storage
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden h-full md:flex">
          <SidebarBody
            section={section}
            pane={pane}
            onSection={go}
            onSettings={() => setPane('settings')}
            onTerminals={() => setPane('terminals')}
          />
        </aside>
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close sidebar" onClick={() => setMobileOpen(false)} />
            <div className="relative z-10 h-full bg-[#1a1a1a]">
              <SidebarBody
                section={section}
                pane={pane}
                onSection={go}
                onSettings={() => {
                  setPane('settings')
                  setMobileOpen(false)
                }}
                onTerminals={() => {
                  setPane('terminals')
                  setMobileOpen(false)
                }}
                onClose={() => setMobileOpen(false)}
              />
            </div>
          </div>
        ) : null}

        {pane === 'settings' ? (
          <SettingsPane
            section={settingsSection}
            onSection={setSettingsSection}
            onBack={() => setPane('files')}
          />
        ) : pane === 'terminals' ? (
          <TerminalPane onBack={() => setPane('files')} />
        ) : (
          <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
            <h1 className="mb-6 text-2xl font-normal tracking-tight text-foreground">{titles[section]}</h1>
            {items.length === 0 ? (
              <EmptyState section={section} search={search} />
            ) : view === 'list' ? (
              <ListView items={items} selected={selected} onSelect={setSelected} />
            ) : (
              <GridView items={items} selected={selected} onSelect={setSelected} />
            )}
          </main>
        )}
      </div>
    </div>
  )
}

function SidebarBody({
  section,
  pane,
  onSection,
  onSettings,
  onTerminals,
  onClose,
}: {
  section: SectionId
  pane: Pane
  onSection: (id: SectionId) => void
  onSettings: () => void
  onTerminals: () => void
  onClose?: () => void
}) {
  const usedPct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
  return (
    <div className="flex h-full w-[256px] shrink-0 flex-col bg-[#1a1a1a]">
      {onClose ? (
        <div className="flex items-center justify-between px-4 pt-3 pb-1 md:hidden">
          <div className="flex items-center gap-2.5">
            <StorebaseLogo className="size-7" />
            <span className="text-[20px] font-medium tracking-tight text-white">Storebase</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close menu">
            <X />
          </Button>
        </div>
      ) : null}
      <div className="px-4 pt-2 pb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-12 items-center gap-3 rounded-2xl bg-white px-5 text-[15px] font-medium text-[#1a1a1a] transition hover:bg-[#f2f2f2]">
              <Plus className="size-5" strokeWidth={2} />
              New
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem>
              <FolderPlus />
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Upload />
              File upload
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <FileText />
              Document
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileSpreadsheet />
              Spreadsheet
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Presentation />
              Presentation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollArea className="flex-1 px-3">
        <nav className="flex flex-col gap-0.5 py-1">
          {nav.map((item) => {
            const Icon = item.icon
            const active = pane === 'files' && section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSection(item.id)}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors',
                  active ? 'bg-white/10 text-white' : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </button>
            )
          })}
          <button
            type="button"
            onClick={onTerminals}
            className={cn(
              'flex h-10 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors',
              pane === 'terminals' ? 'bg-white/10 text-white' : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
            )}
          >
            <SquareTerminal className="size-[18px]" strokeWidth={pane === 'terminals' ? 2 : 1.75} />
            Terminal
          </button>
          <button
            type="button"
            onClick={onSettings}
            className="mt-2 flex h-10 items-center gap-3 rounded-full px-4 text-sm font-medium text-[#b3b3b3] hover:bg-white/5 hover:text-white"
          >
            <Settings className="size-[18px]" strokeWidth={1.75} />
            Settings
          </button>
        </nav>
      </ScrollArea>
      <div className="px-5 py-4">
        <div className="mb-2 flex items-center gap-3 text-sm font-medium text-[#b3b3b3]">
          <HardDrive className="size-[18px]" />
          Storage
        </div>
        <Progress value={usedPct} className="h-1 bg-white/10" />
        <p className="mt-2 text-xs text-[#8d8d8d]">
          {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-8 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
          onClick={onSettings}
        >
          Manage storage
        </Button>
      </div>
    </div>
  )
}

function GridView({
  items,
  selected,
  onSelect,
}: {
  items: DriveItem[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const folders = items.filter((entry) => entry.kind === 'folder')
  const rest = items.filter((entry) => entry.kind !== 'folder')
  const split = folders.length > 0 && rest.length > 0
  return (
    <div className="flex flex-col gap-8">
      {folders.length > 0 ? (
        <section>
          {split ? <h2 className="mb-3 text-sm font-medium text-[#8d8d8d]">Folders</h2> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {folders.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect(entry.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5',
                  selected === entry.id && 'bg-white/10 hover:bg-white/10',
                )}
              >
                <FileGlyph kind="folder" size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{entry.name}</span>
                </span>
                <Marks item={entry} />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section>
          {split ? <h2 className="mb-3 text-sm font-medium text-[#8d8d8d]">Files</h2> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {rest.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect(entry.id)}
                className={cn(
                  'flex w-full flex-col items-stretch rounded-xl p-2 text-left hover:bg-white/5',
                  selected === entry.id && 'bg-white/10 hover:bg-white/10',
                )}
              >
                <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-[#141414]">
                  <FileGlyph kind={entry.kind} size="lg" />
                </div>
                <div className="mt-3 flex items-start gap-2 px-1 pb-1">
                  <FileGlyph kind={entry.kind} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{entry.name}</div>
                    <div className="truncate text-xs text-[#8d8d8d]">{when(entry)}</div>
                  </div>
                  <Marks item={entry} className="ml-auto" />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function ListView({
  items,
  selected,
  onSelect,
}: {
  items: DriveItem[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,2fr)_140px_160px_100px] gap-3 px-3 py-2 text-xs font-medium text-[#8d8d8d] md:grid">
        <span>Name</span>
        <span>Owner</span>
        <span>Date modified</span>
        <span className="text-right">File size</span>
      </div>
      {items.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry.id)}
          className={cn(
            'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-full px-3 py-2.5 text-left hover:bg-white/5 md:grid-cols-[minmax(0,2fr)_140px_160px_100px]',
            selected === entry.id && 'bg-white/10 hover:bg-white/10',
          )}
        >
          <span className="flex min-w-0 items-center gap-3">
            <FileGlyph kind={entry.kind} size="sm" />
            <span className="truncate text-sm">{entry.name}</span>
            <Marks item={entry} />
          </span>
          <span className="hidden truncate text-sm text-[#8d8d8d] md:block">{entry.owner}</span>
          <span className="hidden text-sm text-[#8d8d8d] md:block">{when(entry)}</span>
          <span className="text-right text-sm text-[#8d8d8d]">
            {entry.kind === 'folder' ? '—' : formatBytes(entry.size)}
          </span>
        </button>
      ))}
    </div>
  )
}

function Marks({ item, className }: { item: DriveItem; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {item.shared ? <Users className="size-3.5 text-[#8d8d8d]" /> : null}
      {item.starred ? <Star className="size-3.5 fill-[#fdd663] text-[#fdd663]" /> : null}
    </span>
  )
}

function when(item: DriveItem): string {
  if (item.expiresAt) return '2 days left'
  return formatDate(item.modifiedAt)
}

function EmptyState({ section, search }: { section: SectionId; search: string }) {
  let title = 'This folder is empty'
  let body = 'Right-click for new file, folder, or upload. Drag items into folders to organize.'
  if (search.trim()) {
    title = `No results for "${search.trim()}"`
    body = 'Try a different name, or check another location.'
  } else if (section === 'spam') {
    title = 'Spam is empty'
    body = 'Suspicious shares get parked here.'
  }
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <FileGlyph kind="folder" size="lg" />
      <h2 className="mt-4 text-lg font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[#8d8d8d]">{body}</p>
    </div>
  )
}

const settingsNav = [
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'devices', label: 'Mac app', icon: Laptop },
  { id: 'general', label: 'Platform', icon: SlidersHorizontal },
  { id: 'server', label: 'Server', icon: Server },
  { id: 'domain', label: 'Domain', icon: Globe },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'terminals', label: 'Terminals', icon: SquareTerminal },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
  { id: 'security', label: 'Security', icon: Shield },
]

const fieldClass =
  'h-11 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'

function SettingsPane({
  section,
  onSection,
  onBack,
}: {
  section: string
  onSection: (id: string) => void
  onBack: () => void
}) {
  const usedPct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-[#1a1a1a]">
      <aside className="hidden w-[256px] shrink-0 flex-col md:flex">
        <button
          type="button"
          onClick={onBack}
          className="mx-4 mt-3 mb-2 flex h-10 items-center gap-2 rounded-full px-4 text-sm text-[#b3b3b3] hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to files
        </button>
        <ScrollArea className="flex-1 px-3">
          <nav className="flex flex-col gap-0.5 py-1">
            {settingsNav.map((item) => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSection(item.id)}
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
        {section === 'account' ? (
          <div className="max-w-lg">
            <h1 className="text-2xl font-medium tracking-tight text-white">Account</h1>
            <p className="mt-2 mb-6 text-sm text-[#8d8d8d]">Name and email on this node.</p>
            <div className="space-y-3">
              <Input readOnly className={fieldClass} value={account.name} />
              <Input readOnly className={fieldClass} value={account.email} />
            </div>
          </div>
        ) : section === 'devices' ? (
          <div className="max-w-lg">
            <h1 className="text-2xl font-medium tracking-tight text-white">Mac app</h1>
            <p className="mt-2 mb-6 text-sm text-[#8d8d8d]">
              Install Storebase on a Mac, then paste this node’s link and pairing code. Cloud copies keep the real name
              and icon, tagged Storebase in Finder.
            </p>
            <p className="mb-2 text-sm text-[#8d8d8d]">Node link</p>
            <Input readOnly className={fieldClass} value="http://72.61.3.42:4780" />
            <p className="mt-4 mb-2 text-sm text-[#8d8d8d]">Pairing code</p>
            <Input readOnly className={`${fieldClass} font-mono`} value="K7M2-9QPL" />
          </div>
        ) : section === 'storage' ? (
          <div className="max-w-lg">
            <h1 className="text-2xl font-medium tracking-tight text-white">Storage</h1>
            <p className="mt-2 mb-6 text-sm text-[#8d8d8d]">Node reserve is the disk cap for the machine.</p>
            <Progress value={usedPct} className="h-1 bg-white/10" />
            <p className="mt-3 text-sm text-[#8d8d8d]">
              {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
            </p>
          </div>
        ) : section === 'security' ? (
          <div className="max-w-lg">
            <h1 className="text-2xl font-medium tracking-tight text-white">Security</h1>
            <p className="mt-2 mb-6 text-sm text-[#8d8d8d]">Passwords are scrypt hashes. Sessions are httpOnly cookies.</p>
            <Button variant="outline" className="h-10 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
              <KeyRound className="size-4" />
              Rotate session secret
            </Button>
          </div>
        ) : (
          <div className="max-w-lg">
            <h1 className="text-2xl font-medium tracking-tight text-white">
              {settingsNav.find((item) => item.id === section)?.label}
            </h1>
            <p className="mt-2 text-sm text-[#8d8d8d]">Same screens as the live node. Pair a machine and this is the app.</p>
          </div>
        )}
      </main>
    </div>
  )
}

function TerminalPane({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#1a1a1a]">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 items-center gap-2 rounded-full px-3 text-sm text-[#b3b3b3] hover:bg-white/5 hover:text-white md:hidden"
        >
          <ArrowLeft className="size-4" />
          Files
        </button>
        <button type="button" className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-sm text-white">
          <SquareTerminal className="size-3.5" />
          bash
        </button>
        <Button variant="ghost" size="sm" className="h-9 rounded-full text-white hover:bg-white/10 hover:text-white">
          <Plus className="size-4" />
          New
        </Button>
      </div>
      <div className="mx-4 mb-4 min-h-0 flex-1 overflow-hidden rounded-xl bg-[#141414] px-4 py-3 font-mono text-[13px] leading-6 text-[#e8e8e8]">
        <p className="text-[#8d8d8d]">noah@home-node:~$</p>
        <p>storebase status</p>
        <p className="mt-2 text-[#b3b3b3]">node up · port 4780 · 186 GB of 500 GB</p>
        <p className="mt-2 text-[#8d8d8d]">noah@home-node:~$ <span className="animate-pulse">▍</span></p>
      </div>
    </div>
  )
}
