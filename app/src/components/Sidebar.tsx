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
  FolderPlus,
  HardDrive,
  Home,
  Plus,
  Settings,
  SquareTerminal,
  Star,
  Timer,
  Trash2,
  Upload,
  Users,
  FileText,
  FileSpreadsheet,
  Presentation,
  X,
} from 'lucide-react'

const libraryNav: { id: SectionId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'my-drive', label: 'My files', icon: HardDrive },
  { id: 'shared', label: 'Shared with me', icon: Users },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'starred', label: 'Starred', icon: Star },
]

const manageNav: { id: SectionId; label: string; icon: typeof Home }[] = [
  { id: 'temp', label: 'Temp', icon: Timer },
  { id: 'spam', label: 'Spam', icon: AlertTriangle },
  { id: 'trash', label: 'Trash', icon: Trash2 },
]

type SidebarProps = {
  section: SectionId
  terminalsOpen: boolean
  terminalsEnabled?: boolean
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
  terminalsEnabled = true,
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
    <div className="flex h-full w-[256px] shrink-0 flex-col border-r border-white/[0.07] bg-[#1a1a1a]">
      <div className="flex items-center justify-between px-4 pt-3 pb-1 md:hidden">
        <div className="flex items-center gap-2.5">
          <StorebaseLogo className="size-7" />
          <span className="text-[20px] font-medium tracking-tight text-white">Storebase</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onCloseMobile} aria-label="Close menu">
          <X />
        </Button>
      </div>

      <div className="px-3 pt-3 pb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-11 w-full items-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-[#1a1a1a] shadow-sm transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#f2f2f2] active:scale-[0.98]">
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
        <nav className="flex flex-col py-1">
          <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.12em] text-[#777] uppercase">Library</p>
          <div className="flex flex-col gap-0.5">
          {libraryNav.map((item) => {
            const Icon = item.icon
            const active = !terminalsOpen && section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSection(item.id)}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98]',
                  active
                    ? 'bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]'
                    : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </button>
            )
          })}
          </div>
          <p className="mt-5 mb-1.5 px-3 text-[10px] font-semibold tracking-[0.12em] text-[#777] uppercase">Manage</p>
          <div className="flex flex-col gap-0.5">
          {manageNav.map((item) => {
            const Icon = item.icon
            const active = !terminalsOpen && section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSection(item.id)}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98]',
                  active
                    ? 'bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]'
                    : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </button>
            )
          })}
          </div>
          <div className="my-3 h-px bg-white/[0.06]" />
          {terminalsEnabled ? (
            <button
              type="button"
              onClick={onOpenTerminals}
              className={cn(
                'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98]',
                terminalsOpen
                  ? 'bg-white/10 text-white'
                  : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
              )}
            >
              <SquareTerminal className="size-[18px]" strokeWidth={terminalsOpen ? 2 : 1.75} />
              Terminal
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-[#b3b3b3] transition-[background-color,color,transform] duration-150 hover:bg-white/5 hover:text-white active:scale-[0.98]"
          >
            <Settings className="size-[18px]" strokeWidth={1.75} />
            Settings
          </button>
        </nav>
      </ScrollArea>

      <div className="border-t border-white/[0.06] px-4 py-4">
        <div className="mb-2 flex items-center gap-3 text-sm font-medium text-[#b3b3b3]">
          <HardDrive className="size-[18px]" />
          Storage
        </div>
        <Progress value={usedPct} className="h-1.5 bg-white/10" />
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
