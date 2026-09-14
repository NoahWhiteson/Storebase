import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatBytes } from '@/lib/format'
import type { FileKind, SectionId } from '@/types'
import { cn } from 'cn'
import {
  AlertTriangle,
  Clock,
  Computer,
  FolderPlus,
  HardDrive,
  Home,
  Plus,
  Settings,
  SquareTerminal,
  Star,
  Trash2,
  Upload,
  Users,
  FileText,
  FileSpreadsheet,
  Presentation,
  X,
} from 'lucide-react'

const nav: { id: SectionId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'my-drive', label: 'My files', icon: HardDrive },
  { id: 'computers', label: 'Computers', icon: Computer },
  { id: 'shared', label: 'Shared with me', icon: Users },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'spam', label: 'Spam', icon: AlertTriangle },
  { id: 'trash', label: 'Trash', icon: Trash2 },
]

type SidebarProps = {
  section: SectionId
  terminalsOpen: boolean
  usedBytes: number
  quotaBytes: number
  mobileOpen: boolean
  onCloseMobile: () => void
  onSection: (id: SectionId) => void
  onNewFolder: () => void
  onUpload: () => void
  onCreateFile: (kind: FileKind) => void
  onOpenSettings: () => void
  onOpenTerminals: () => void
}

export function Sidebar({
  section,
  terminalsOpen,
  usedBytes,
  quotaBytes,
  mobileOpen,
  onCloseMobile,
  onSection,
  onNewFolder,
  onUpload,
  onCreateFile,
  onOpenSettings,
  onOpenTerminals,
}: SidebarProps) {
  const usedPct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100))

  const body = (
    <div className="flex h-full w-[256px] shrink-0 flex-col bg-[#1a1a1a]">
      <div className="flex items-center justify-between px-4 pt-3 pb-1 md:hidden">
        <div className="flex items-center gap-2.5">
          <StorebaseLogo className="size-7" />
          <span className="text-[20px] font-medium tracking-tight text-white">Storebase</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onCloseMobile} aria-label="Close menu">
          <X />
        </Button>
      </div>

      <div className="px-4 pt-2 pb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-12 items-center gap-3 rounded-2xl bg-white px-5 text-[15px] font-medium text-[#1a1a1a] transition hover:bg-[#f2f2f2]">
              <Plus className="size-5" strokeWidth={2} />
              New
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={onNewFolder}>
              <FolderPlus />
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUpload}>
              <Upload />
              File upload
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onCreateFile('doc')}>
              <FileText />
              Document
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCreateFile('sheet')}>
              <FileSpreadsheet />
              Spreadsheet
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCreateFile('slide')}>
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
            const active = !terminalsOpen && section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSection(item.id)}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors',
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </button>
            )
          })}
          <button
            type="button"
            onClick={onOpenTerminals}
            className={cn(
              'flex h-10 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors',
              terminalsOpen
                ? 'bg-white/10 text-white'
                : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
            )}
          >
            <SquareTerminal className="size-[18px]" strokeWidth={terminalsOpen ? 2 : 1.75} />
            Terminal
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
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
          onClick={onOpenSettings}
        >
          Manage storage
        </Button>
      </div>
    </div>
  )

  return (
    <>
      <aside className="hidden h-full md:flex">{body}</aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close sidebar"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full bg-[#1a1a1a]">{body}</div>
        </div>
      ) : null}
    </>
  )
}
