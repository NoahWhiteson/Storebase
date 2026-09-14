import { DriveLogo } from '@/components/DriveLogo'
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
import { Separator } from '@/components/ui/separator'
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
  { id: 'my-drive', label: 'My Drive', icon: HardDrive },
  { id: 'computers', label: 'Computers', icon: Computer },
  { id: 'shared', label: 'Shared with me', icon: Users },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'spam', label: 'Spam', icon: AlertTriangle },
  { id: 'trash', label: 'Trash', icon: Trash2 },
]

type SidebarProps = {
  section: SectionId
  usedBytes: number
  quotaBytes: number
  mobileOpen: boolean
  onCloseMobile: () => void
  onSection: (id: SectionId) => void
  onNewFolder: () => void
  onUpload: () => void
  onCreateFile: (kind: FileKind) => void
}

export function Sidebar({
  section,
  usedBytes,
  quotaBytes,
  mobileOpen,
  onCloseMobile,
  onSection,
  onNewFolder,
  onUpload,
  onCreateFile,
}: SidebarProps) {
  const usedPct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100))

  const body = (
    <div className="flex h-full w-[272px] shrink-0 flex-col bg-background">
      <div className="flex items-center justify-between px-4 pt-3 pb-1 md:hidden">
        <div className="flex items-center gap-2.5">
          <DriveLogo className="size-7" />
          <span className="text-[22px] font-medium tracking-tight text-[#e3e3e3]">Drive</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onCloseMobile} aria-label="Close menu">
          <X />
        </Button>
      </div>

      <div className="px-4 pt-3 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-14 w-[118px] items-center gap-3 rounded-2xl bg-[#e3e3e3] px-4 text-[15px] font-medium text-[#1f1f1f] shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition hover:shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
              <Plus className="size-6" strokeWidth={1.75} />
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

      <ScrollArea className="flex-1 px-2">
        <nav className="flex flex-col gap-0.5 py-1">
          {nav.map((item) => {
            const Icon = item.icon
            const active = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSection(item.id)}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors',
                  active
                    ? 'bg-[#394457] text-[#d3e3fd]'
                    : 'text-[#c4c7c5] hover:bg-[#2c2c2c]',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </button>
            )
          })}
        </nav>
      </ScrollArea>

      <Separator />
      <div className="px-5 py-4">
        <div className="mb-2 flex items-center gap-3 text-sm font-medium text-[#c4c7c5]">
          <HardDrive className="size-[18px]" />
          Storage
        </div>
        <Progress value={usedPct} className="h-1 bg-[#3c4043]" />
        <p className="mt-2 text-xs text-muted-foreground">
          {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-8 rounded-full border-[#8ab4f8]/40 text-[#8ab4f8] hover:bg-[#8ab4f8]/10 hover:text-[#8ab4f8]"
        >
          Get more storage
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
          <div className="relative z-10 h-full shadow-2xl">{body}</div>
        </div>
      ) : null}
    </>
  )
}
