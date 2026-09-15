import { FileGlyph } from '@/components/FileGlyph'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { formatBytes, formatDate } from '@/lib/format'
import { isZipName, previewKind } from '@/lib/preview'
import { rawUrl } from '@/lib/api'
import type { DriveItem, SectionId } from '@/types'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import {
  ArchiveRestore,
  ArrowDownAz,
  Calendar,
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
  Pencil,
  Share2,
  Star,
  Trash2,
  Undo2,
  Upload,
  UserMinus,
  Users,
} from 'lucide-react'

export type SortKey = 'name' | 'modified' | 'size'

type FileViewProps = {
  items: DriveItem[]
  view: 'grid' | 'list'
  section: SectionId
  selectedIds: string[]
  search: string
  sort: SortKey
  onSort: (key: SortKey) => void
  onView: (view: 'grid' | 'list') => void
  canCreate: boolean
  onNewFolder: () => void
  onNewFile: () => void
  onUpload: () => void
  onSelect: (id: string, additive: boolean) => void
  onOpen: (item: DriveItem) => void
  onStar: (id: string) => void
  onShare: (id: string) => void
  onRename: (id: string) => void
  onTrash: (id: string) => void
  onRestore: (id: string) => void
  onDeleteForever: (id: string) => void
  onRemoveShare: (id: string) => void
  onDownload: (item: DriveItem) => void
  onUnzip: (id: string) => void
}

export function FileView(props: FileViewProps) {
  const ordered = sortItems(props.items, props.sort)
  const folders = ordered.filter((item) => item.kind === 'folder')
  const files = ordered.filter((item) => item.kind !== 'folder')
  const showSplit = props.view === 'grid' && folders.length > 0 && files.length > 0
  const empty = props.items.length === 0

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="min-h-[320px]">
          {empty ? (
            <EmptyState section={props.section} search={props.search} />
          ) : props.view === 'list' ? (
            <ListView {...props} items={ordered} />
          ) : (
            <GridView {...props} folders={folders} files={files} showSplit={showSplit} />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {props.canCreate ? (
          <>
            <ContextMenuItem onSelect={props.onNewFolder}>
              <FolderPlus />
              New folder
            </ContextMenuItem>
            <ContextMenuItem onSelect={props.onNewFile}>
              <FilePlus />
              New file
            </ContextMenuItem>
            <ContextMenuItem onSelect={props.onUpload}>
              <Upload />
              Upload
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuRadioGroup value={props.sort} onValueChange={(value) => props.onSort(value as SortKey)}>
          <ContextMenuRadioItem value="name">
            <ArrowDownAz />
            Sort by name
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="modified">
            <Calendar />
            Sort by date
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="size">
            <HardDrive />
            Sort by size
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuRadioGroup
          value={props.view}
          onValueChange={(value) => props.onView(value as 'grid' | 'list')}
        >
          <ContextMenuRadioItem value="grid">
            <LayoutGrid />
            Grid
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="list">
            <List />
            List
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function sortItems(items: DriveItem[], sort: SortKey): DriveItem[] {
  return [...items].sort((a, b) => {
    if (sort === 'size') return (b.size ?? 0) - (a.size ?? 0)
    if (sort === 'modified') return b.modifiedAt.localeCompare(a.modifiedAt)
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function ListView(props: FileViewProps & { items: DriveItem[] }) {
  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,2fr)_140px_160px_100px] gap-3 px-3 py-2 text-xs font-medium text-[#8d8d8d] md:grid">
        <span>Name</span>
        <span>Owner</span>
        <span>{props.section === 'trash' ? 'Retention' : 'Date modified'}</span>
        <span className="text-right">File size</span>
      </div>
      {props.items.map((item) => (
        <ItemMenu key={item.id} item={item} {...handlers(props)}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              props.onSelect(item.id, e.metaKey || e.ctrlKey)
            }}
            onDoubleClick={() => props.onOpen(item)}
            className={cn(
              'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-full px-3 py-2.5 text-left hover:bg-white/5 md:grid-cols-[minmax(0,2fr)_140px_160px_100px]',
              props.selectedIds.includes(item.id) && 'bg-white/10 hover:bg-white/10',
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <FileGlyph kind={item.kind} size="sm" />
              <span className="truncate text-sm">{item.name}</span>
              <Marks item={item} />
            </span>
            <span className="hidden truncate text-sm text-[#8d8d8d] md:block">{item.owner}</span>
            <span className="hidden text-sm text-[#8d8d8d] md:block">{when(item)}</span>
            <span className="text-right text-sm text-[#8d8d8d]">
              {item.kind === 'folder' ? '—' : formatBytes(item.size)}
            </span>
          </button>
        </ItemMenu>
      ))}
    </div>
  )
}

function GridView({
  folders,
  files,
  showSplit,
  ...props
}: FileViewProps & { folders: DriveItem[]; files: DriveItem[]; showSplit: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      {folders.length > 0 ? (
        <section>
          {showSplit ? <h2 className="mb-3 text-sm font-medium text-[#8d8d8d]">Folders</h2> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {folders.map((item) => (
              <ItemMenu key={item.id} item={item} {...handlers(props)}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onSelect(item.id, e.metaKey || e.ctrlKey)
                  }}
                  onDoubleClick={() => props.onOpen(item)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5',
                    props.selectedIds.includes(item.id) && 'bg-white/10 hover:bg-white/10',
                  )}
                >
                  <FileGlyph kind="folder" size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                  <Marks item={item} />
                </button>
              </ItemMenu>
            ))}
          </div>
        </section>
      ) : null}
      {files.length > 0 ? (
        <section>
          {showSplit ? <h2 className="mb-3 text-sm font-medium text-[#8d8d8d]">Files</h2> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {files.map((item) => (
              <ItemMenu key={item.id} item={item} {...handlers(props)}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onSelect(item.id, e.metaKey || e.ctrlKey)
                  }}
                  onDoubleClick={() => props.onOpen(item)}
                  className={cn(
                    'flex w-full flex-col items-stretch rounded-xl p-2 text-left hover:bg-white/5',
                    props.selectedIds.includes(item.id) && 'bg-white/10 hover:bg-white/10',
                  )}
                >
                  <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-white/[0.04]">
                    {previewKind(item.name) === 'image' && item.owned !== false ? (
                      <img src={rawUrl(item.id)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <FileGlyph kind={item.kind} size="lg" />
                    )}
                  </div>
                  <div className="mt-3 flex items-start gap-2 px-1 pb-1">
                    <FileGlyph kind={item.kind} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="truncate text-xs text-[#8d8d8d]">{when(item)}</div>
                    </div>
                    <Marks item={item} className="ml-auto" />
                  </div>
                </button>
              </ItemMenu>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function handlers(props: FileViewProps) {
  return {
    onOpen: props.onOpen,
    onStar: props.onStar,
    onShare: props.onShare,
    onRename: props.onRename,
    onTrash: props.onTrash,
    onRestore: props.onRestore,
    onDeleteForever: props.onDeleteForever,
    onRemoveShare: props.onRemoveShare,
    onDownload: props.onDownload,
    onUnzip: props.onUnzip,
  }
}

function when(item: DriveItem): string {
  if (item.trashed && item.daysLeft != null) {
    if (item.daysLeft <= 0) return 'Expires today'
    return `${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'} left`
  }
  return formatDate(item.modifiedAt)
}

function Marks({ item, className }: { item: DriveItem; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {item.shared && item.owned !== false ? <Users className="size-3.5 text-[#8d8d8d]" /> : null}
      {item.starred ? <Star className="size-3.5 fill-[#fdd663] text-[#fdd663]" /> : null}
    </span>
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
  onDeleteForever,
  onRemoveShare,
  onDownload,
  onUnzip,
}: {
  item: DriveItem
  children: ReactNode
  onOpen: (item: DriveItem) => void
  onStar: (id: string) => void
  onShare: (id: string) => void
  onRename: (id: string) => void
  onTrash: (id: string) => void
  onRestore: (id: string) => void
  onDeleteForever: (id: string) => void
  onRemoveShare: (id: string) => void
  onDownload: (item: DriveItem) => void
  onUnzip: (id: string) => void
}) {
  const inbound = item.owned === false
  const shareRoot = inbound && Boolean(item.shareId) && item.id === `share:${item.shareId}`
  const zip = !inbound && !item.trashed && isZipName(item.name)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => onOpen(item)}>
          <FolderOpen />
          Open
        </ContextMenuItem>
        {inbound ? null : (
          <ContextMenuItem onSelect={() => onShare(item.id)}>
            <Share2 />
            Share
          </ContextMenuItem>
        )}
        {inbound || item.trashed ? null : (
          <ContextMenuItem onSelect={() => onStar(item.id)}>
            <Star />
            {item.starred ? 'Remove star' : 'Add to starred'}
          </ContextMenuItem>
        )}
        {inbound || item.trashed ? null : (
          <ContextMenuItem onSelect={() => onRename(item.id)}>
            <Pencil />
            Rename
          </ContextMenuItem>
        )}
        {zip ? (
          <ContextMenuItem onSelect={() => onUnzip(item.id)}>
            <ArchiveRestore />
            Unzip
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => onDownload(item)}>
          <Download />
          Download
        </ContextMenuItem>
        {item.trashed || !inbound || shareRoot ? <ContextMenuSeparator /> : null}
        {item.trashed ? (
          <>
            <ContextMenuItem onSelect={() => onRestore(item.id)}>
              <Undo2 />
              Restore
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => onDeleteForever(item.id)}>
              <Trash2 />
              Delete forever
            </ContextMenuItem>
          </>
        ) : inbound ? (
          shareRoot ? (
            <ContextMenuItem onSelect={() => onRemoveShare(item.id)}>
              <UserMinus />
              Remove
            </ContextMenuItem>
          ) : null
        ) : (
          <ContextMenuItem variant="destructive" onSelect={() => onTrash(item.id)}>
            <Trash2 />
            {item.size != null && item.size > 20 * 1024 ** 3 ? 'Delete permanently' : 'Move to trash'}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function EmptyState({ section, search }: { section: SectionId; search: string }) {
  let title = 'This folder is empty'
  let body = 'Right-click for new file, folder, or upload.'

  if (search.trim()) {
    title = `No results for "${search.trim()}"`
    body = 'Try a different name, or check another location.'
  } else if (section === 'starred') {
    title = 'No starred files'
    body = 'Star items you want to find fast. They show up here.'
  } else if (section === 'trash') {
    title = 'Trash is empty'
    body = 'Files stay 30 days, then they’re gone. Empty trash to wipe now. Anything over 20 GB skips trash.'
  } else if (section === 'shared') {
    title = 'Nothing shared with you'
    body = 'When someone on this node shares a file, it lands here.'
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
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <FileGlyph kind="folder" size="lg" />
      <h2 className="mt-4 text-lg font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[#8d8d8d]">{body}</p>
    </div>
  )
}
