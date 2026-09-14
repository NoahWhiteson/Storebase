import { FileGlyph } from '@/components/FileGlyph'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { formatBytes, formatDate } from '@/lib/format'
import type { DriveItem, SectionId } from '@/types'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { Download, FolderOpen, Pencil, Share2, Star, Trash2, Undo2 } from 'lucide-react'

type FileViewProps = {
  items: DriveItem[]
  view: 'grid' | 'list'
  section: SectionId
  selectedIds: string[]
  search: string
  onSelect: (id: string, additive: boolean) => void
  onOpen: (item: DriveItem) => void
  onStar: (id: string) => void
  onShare: (id: string) => void
  onRename: (id: string) => void
  onTrash: (id: string) => void
  onRestore: (id: string) => void
}

export function FileView({
  items,
  view,
  section,
  selectedIds,
  search,
  onSelect,
  onOpen,
  onStar,
  onShare,
  onRename,
  onTrash,
  onRestore,
}: FileViewProps) {
  if (items.length === 0) {
    return (
      <EmptyState section={section} search={search} />
    )
  }

  return view === 'grid' ? (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {items.map((item) => (
        <ItemMenu
          key={item.id}
          item={item}
          onOpen={onOpen}
          onStar={onStar}
          onShare={onShare}
          onRename={onRename}
          onTrash={onTrash}
          onRestore={onRestore}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(item.id, e.metaKey || e.ctrlKey)
            }}
            onDoubleClick={() => onOpen(item)}
            className={cn(
              'flex w-full flex-col items-stretch rounded-xl border border-transparent bg-[#222222] p-3 text-left transition hover:bg-[#2a2a2a]',
              selectedIds.includes(item.id) && 'border-[#8ab4f8]/40 bg-[#394457]',
            )}
          >
            <div className="flex h-28 items-center justify-center rounded-lg bg-[#1a1a1a]/60">
              <FileGlyph kind={item.kind} size="lg" />
            </div>
            <div className="mt-3 flex items-start gap-2">
              <FileGlyph kind={item.kind} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.kind === 'folder' ? 'Folder' : formatDate(item.modifiedAt)}
                </div>
              </div>
              {item.starred ? <Star className="ml-auto size-3.5 shrink-0 fill-[#fdd663] text-[#fdd663]" /> : null}
            </div>
          </button>
        </ItemMenu>
      ))}
    </div>
  ) : (
    <div className="overflow-hidden rounded-xl border border-[#2e2e2e]">
      <div className="hidden grid-cols-[minmax(0,2fr)_140px_160px_100px] gap-3 border-b border-[#2e2e2e] px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
        <span>Name</span>
        <span>Owner</span>
        <span>Date modified</span>
        <span className="text-right">Size</span>
      </div>
      {items.map((item) => (
        <ItemMenu
          key={item.id}
          item={item}
          onOpen={onOpen}
          onStar={onStar}
          onShare={onShare}
          onRename={onRename}
          onTrash={onTrash}
          onRestore={onRestore}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(item.id, e.metaKey || e.ctrlKey)
            }}
            onDoubleClick={() => onOpen(item)}
            className={cn(
              'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#2e2e2e] px-4 py-2.5 text-left last:border-0 hover:bg-[#242424] md:grid-cols-[minmax(0,2fr)_140px_160px_100px]',
              selectedIds.includes(item.id) && 'bg-[#394457] hover:bg-[#394457]',
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <FileGlyph kind={item.kind} size="sm" />
              <span className="truncate text-sm">{item.name}</span>
              {item.starred ? <Star className="size-3.5 shrink-0 fill-[#fdd663] text-[#fdd663]" /> : null}
            </span>
            <span className="hidden truncate text-sm text-muted-foreground md:block">{item.owner}</span>
            <span className="hidden text-sm text-muted-foreground md:block">{formatDate(item.modifiedAt)}</span>
            <span className="text-right text-sm text-muted-foreground">
              {item.kind === 'folder' ? '—' : formatBytes(item.size)}
            </span>
          </button>
        </ItemMenu>
      ))}
    </div>
  )
}

function ItemMenu({
  item,
  children,
  onOpen,
  onStar,
  onShare,
  onRename,
  onTrash,
  onRestore,
}: {
  item: DriveItem
  children: ReactNode
  onOpen: (item: DriveItem) => void
  onStar: (id: string) => void
  onShare: (id: string) => void
  onRename: (id: string) => void
  onTrash: (id: string) => void
  onRestore: (id: string) => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => onOpen(item)}>
          <FolderOpen />
          Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onShare(item.id)}>
          <Share2 />
          Share
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onStar(item.id)}>
          <Star />
          {item.starred ? 'Remove star' : 'Add to starred'}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRename(item.id)}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuItem>
          <Download />
          Download
        </ContextMenuItem>
        <ContextMenuSeparator />
        {item.trashed ? (
          <ContextMenuItem onSelect={() => onRestore(item.id)}>
            <Undo2 />
            Restore
          </ContextMenuItem>
        ) : (
          <ContextMenuItem variant="destructive" onSelect={() => onTrash(item.id)}>
            <Trash2 />
            Move to trash
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function EmptyState({ section, search }: { section: SectionId; search: string }) {
  let title = 'This folder is empty'
  let body = 'Drop files here or use New to add a folder.'

  if (search.trim()) {
    title = `No results for "${search.trim()}"`
    body = 'Try a different name, or check another location.'
  } else if (section === 'starred') {
    title = 'No starred files'
    body = 'Star items you want to find fast. They show up here.'
  } else if (section === 'trash') {
    title = 'Trash is empty'
    body = 'Items you delete hang out here until you empty it.'
  } else if (section === 'shared') {
    title = 'Nothing shared with you'
    body = 'Files other people share will land here.'
  } else if (section === 'spam') {
    title = 'Spam is empty'
    body = 'Suspicious shares get parked here.'
  } else if (section === 'recent') {
    title = 'No recent files'
    body = 'Open something and it will show up in this list.'
  } else if (section === 'computers') {
    title = 'No computers backup'
    body = 'Backup a desktop folder and it appears in Computers.'
  }

  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-[#333] px-6 text-center">
      <FileGlyph kind="folder" size="lg" />
      <h2 className="mt-4 text-lg font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
