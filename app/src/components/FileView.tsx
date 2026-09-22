import { FileGlyph } from '@/components/FileGlyph'
import { SafetyGauge } from '@/components/SafetyGauge'
import { GetInfoDialog } from '@/components/GetInfoDialog'
import { VideoThumb } from '@/components/VideoThumb'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { formatBytes, formatDate, formatRemaining } from '@/lib/format'
import { isZipName, previewKind } from '@/lib/preview'
import { isTempId, rawUrl, reportFileLoadFailure } from '@/lib/api'
import type { DriveItem, SectionId } from '@/types'
import { cn } from 'cn'
import type { DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore,
  ArrowDownAz,
  Calendar,
  Check,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Info,
  LayoutGrid,
  List,
  Pencil,
  Share2,
  ShieldCheck,
  Star,
  Timer,
  Trash2,
  Undo2,
  Upload,
  UserMinus,
  Users,
} from 'lucide-react'

export type SortKey = 'name' | 'modified' | 'size'

export type SelectMods = { toggle: boolean; range: boolean }

export function sortItems(items: DriveItem[], sort: SortKey): DriveItem[] {
  return [...items].sort((a, b) => {
    if (sort === 'size') return (b.size ?? 0) - (a.size ?? 0)
    if (sort === 'modified') return b.modifiedAt.localeCompare(a.modifiedAt)
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

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
  canMove: boolean
  onNewFolder: () => void
  onNewFile: () => void
  onUpload: () => void
  onSelect: (id: string, mods: SelectMods) => void
  onSelectMany: (ids: string[], append: boolean) => void
  onOpen: (item: DriveItem) => void
  onStar: (ids: string[]) => void
  onShare: (id: string) => void
  onRename: (id: string) => void
  onTrash: (ids: string[]) => void
  onRestore: (ids: string[]) => void
  onDeleteForever: (ids: string[]) => void
  onRemoveShare: (id: string) => void
  onDownload: (items: DriveItem[]) => void
  onUnzip: (ids: string[]) => void
  onMove: (paths: string[], dest: string) => void
  onDropFiles?: (files: FileList, dest: string) => void
  onMoveToTemp: (ids: string[]) => void
  onKeep: (ids: string[]) => void
  onCopy: (ids: string[]) => void
  onAcceptShare: (id: string) => void
  onVirusScan: (ids: string[]) => void
}

export function FileView(props: FileViewProps) {
  const ordered = useMemo(() => sortItems(props.items, props.sort), [props.items, props.sort])
  const folders = ordered.filter((item) => item.kind === 'folder')
  const files = ordered.filter((item) => item.kind !== 'folder')
  const showSplit = props.view === 'grid' && folders.length > 0 && files.length > 0
  const empty = props.items.length === 0
  const [dragIds, setDragIds] = useState<string[]>([])
  const [overId, setOverId] = useState<string | null>(null)
  const [infoItem, setInfoItem] = useState<DriveItem | null>(null)
  const draggingRef = useRef(false)
  const marqueeStart = useRef<{ x: number; y: number; append: boolean } | null>(null)
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  function beginMarquee(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-file-id],button,input,textarea,a')) return
    marqueeStart.current = { x: e.clientX, y: e.clientY, append: e.metaKey || e.ctrlKey }
    setMarquee({ left: e.clientX, top: e.clientY, width: 0, height: 0 })
    const move = (event: PointerEvent) => {
      const start = marqueeStart.current
      if (!start) return
      const rect = {
        left: Math.min(start.x, event.clientX),
        top: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      }
      setMarquee(rect)
      const right = rect.left + rect.width
      const bottom = rect.top + rect.height
      const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-file-id]'))
        .filter((element) => {
          const box = element.getBoundingClientRect()
          return box.left < right && box.right > rect.left && box.top < bottom && box.bottom > rect.top
        })
        .map((element) => element.dataset.fileId!)
      props.onSelectMany([...new Set(ids)], start.append)
    }
    const up = () => {
      marqueeStart.current = null
      setMarquee(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  function beginDrag(item: DriveItem, e: DragEvent) {
    if (!props.canMove || !movable(item)) {
      e.preventDefault()
      return
    }
    const ids = props.selectedIds.includes(item.id) && props.selectedIds.length > 0 ? props.selectedIds : [item.id]
    draggingRef.current = true
    setDragIds(ids)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify(ids))
  }

  function endDrag() {
    setDragIds([])
    setOverId(null)
    window.setTimeout(() => {
      draggingRef.current = false
    }, 0)
  }

  function dropOn(dest: string, e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOverId(null)
    if (e.dataTransfer.files.length && props.onDropFiles) {
      props.onDropFiles(e.dataTransfer.files, dest)
      setDragIds([])
      return
    }
    const raw = e.dataTransfer.getData('text/plain')
    let paths = dragIds
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) paths = parsed.filter((id): id is string => typeof id === 'string')
    } catch {
      // keep dragIds
    }
    const valid = paths.filter((id) => id !== dest && !dest.startsWith(`${id}/`))
    if (valid.length) props.onMove(valid, dest)
    setDragIds([])
  }

  const drag = {
    dragIds,
    overId,
    setOverId,
    beginDrag,
    endDrag,
    dropOn,
    draggingRef,
    canMove: props.canMove,
  }

  const blankMenu = (
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
      <ContextMenuRadioGroup value={props.view} onValueChange={(value) => props.onView(value as 'grid' | 'list')}>
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
  )

  const shell = empty ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="min-h-[320px]">
          <EmptyState section={props.section} search={props.search} />
        </div>
      </ContextMenuTrigger>
      {blankMenu}
    </ContextMenu>
  ) : (
    <div className="relative min-h-[320px] select-none" onPointerDown={beginMarquee}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="absolute inset-0 z-0" />
        </ContextMenuTrigger>
        {blankMenu}
      </ContextMenu>
      <div className="relative z-10">
        {props.view === 'list' ? (
          <ListView {...props} items={ordered} drag={drag} onGetInfo={setInfoItem} />
        ) : (
          <GridView
            {...props}
            folders={folders}
            files={files}
            showSplit={showSplit}
            drag={drag}
            onGetInfo={setInfoItem}
          />
        )}
      </div>
      {marquee ? <div className="pointer-events-none fixed z-50 rounded border border-blue-300 bg-blue-400/15" style={marquee} /> : null}
    </div>
  )

  return (
    <>
      {shell}
      {infoItem ? <GetInfoDialog item={infoItem} onClose={() => setInfoItem(null)} /> : null}
    </>
  )
}

type DragApi = {
  dragIds: string[]
  overId: string | null
  setOverId: (id: string | null) => void
  beginDrag: (item: DriveItem, e: DragEvent) => void
  endDrag: () => void
  dropOn: (dest: string, e: DragEvent) => void
  draggingRef: { current: boolean }
  canMove: boolean
}

function ListView(props: FileViewProps & { items: DriveItem[]; drag: DragApi; onGetInfo: (item: DriveItem) => void }) {
  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,2fr)_140px_160px_100px] gap-3 px-3 py-2 text-xs font-medium text-[#8d8d8d] md:grid">
        <span>Name</span>
        <span>Owner</span>
        <span>
          {props.section === 'trash' || props.section === 'temp' ? 'Retention' : 'Date modified'}
        </span>
        <span className="text-right">File size</span>
      </div>
      {props.items.map((item) => (
        <ItemMenu key={item.id} item={item} items={props.items} selectedIds={props.selectedIds} {...handlers(props)}>
          <Tile
            item={item}
            selected={props.selectedIds.includes(item.id)}
            drag={props.drag}
            onSelect={props.onSelect}
            onOpen={props.onOpen}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-full px-3 py-2.5 text-left hover:bg-white/5 md:grid-cols-[minmax(0,2fr)_140px_160px_100px]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <ItemThumb item={item} size="sm" />
              <span className="truncate text-sm">{item.name}</span>
              <Marks item={item} />
            </span>
            <span className="hidden truncate text-sm text-[#8d8d8d] md:block">{item.owner}</span>
            <span className="hidden text-sm text-[#8d8d8d] md:block">{when(item)}</span>
            <span className="text-right text-sm text-[#8d8d8d]">
              {item.kind === 'folder' ? '—' : formatBytes(item.size)}
            </span>
          </Tile>
        </ItemMenu>
      ))}
    </div>
  )
}

function GridView({
  folders,
  files,
  showSplit,
  drag,
  ...props
}: FileViewProps & {
  folders: DriveItem[]
  files: DriveItem[]
  showSplit: boolean
  drag: DragApi
  onGetInfo: (item: DriveItem) => void
}) {
  return (
    <div className="flex flex-col gap-8">
      {folders.length > 0 ? (
        <section>
          {showSplit ? <h2 className="mb-3 text-sm font-medium text-[#8d8d8d]">Folders</h2> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {folders.map((item) => (
              <ItemMenu key={item.id} item={item} items={props.items} selectedIds={props.selectedIds} {...handlers(props)}>
                <Tile
                  item={item}
                  selected={props.selectedIds.includes(item.id)}
                  drag={drag}
                  onSelect={props.onSelect}
                  onOpen={props.onOpen}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5"
                >
                  <FileGlyph kind="folder" size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    {item.expiresAt && !item.trashed ? (
                      <span className="block truncate text-xs text-[#8d8d8d]">{when(item)}</span>
                    ) : null}
                  </span>
                  <Marks item={item} />
                </Tile>
              </ItemMenu>
            ))}
          </div>
        </section>
      ) : null}
      {files.length > 0 ? (
        <section>
          {showSplit ? <h2 className="mb-3 text-sm font-medium text-[#8d8d8d]">Files</h2> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {files.map((item) => {
              const preview = item.kind === 'image' || item.kind === 'video'
              return (
              <ItemMenu key={item.id} item={item} items={props.items} selectedIds={props.selectedIds} {...handlers(props)}>
                <Tile
                  item={item}
                  selected={props.selectedIds.includes(item.id)}
                  drag={drag}
                  onSelect={props.onSelect}
                  onOpen={props.onOpen}
                  className={
                    preview
                      ? 'flex w-full flex-col items-stretch rounded-xl p-2 text-left hover:bg-white/5'
                      : 'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5'
                  }
                >
                  {preview ? (
                    <>
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-[#141414]">
                        <ItemThumb item={item} size="lg" />
                      </div>
                      <div className="mt-2 flex items-start gap-2 px-1 pb-0.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.name}</div>
                          <div className="truncate text-xs text-[#8d8d8d]">{when(item)}</div>
                        </div>
                        <Marks item={item} />
                      </div>
                    </>
                  ) : (
                    <>
                      <FileGlyph kind={item.kind} name={item.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.name}</span>
                        <span className="block truncate text-xs text-[#8d8d8d]">{when(item)}</span>
                      </span>
                      <Marks item={item} />
                    </>
                  )}
                </Tile>
              </ItemMenu>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function ItemThumb({ item, size }: { item: DriveItem; size: 'sm' | 'lg' }) {
  const video = item.kind === 'video'
  const image = previewKind(item.name) === 'image'
  if (video) {
    return (
      <VideoThumb
        url={rawUrl(item.id)}
        path={item.id}
        className={size === 'lg' ? 'h-full w-full' : 'size-8 shrink-0 rounded-md'}
      />
    )
  }
  if (image && size === 'lg') {
    return <img loading="lazy" decoding="async" src={rawUrl(item.id)} alt="" className="h-full w-full object-cover" onError={() => void reportFileLoadFailure(item.id)} />
  }
  return <FileGlyph kind={item.kind} name={item.name} size={size} />
}

function movable(item: DriveItem): boolean {
  return item.owned !== false && !item.trashed && !item.computer
}

function droppable(item: DriveItem, dragIds: string[]): boolean {
  if (item.kind !== 'folder' || !movable(item)) return false
  return !dragIds.some((id) => item.id === id || item.id.startsWith(`${id}/`))
}

function Tile({
  item,
  selected,
  drag,
  onSelect,
  onOpen,
  className,
  children,
}: {
  item: DriveItem
  selected: boolean
  drag: DragApi
  onSelect: (id: string, mods: SelectMods) => void
  onOpen: (item: DriveItem) => void
  className?: string
  children: ReactNode
}) {
  const canDrop = drag.canMove && droppable(item, drag.dragIds)
  const over = drag.overId === item.id && canDrop
  return (
    <button
      type="button"
      data-drive-item
      data-file-id={item.id}
      draggable={false}
      onMouseDown={(e) => {
        e.currentTarget.draggable = drag.canMove && movable(item) && e.button === 0
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (drag.draggingRef.current) return
        onSelect(item.id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey })
      }}
      onDoubleClick={() => onOpen(item)}
      onDragStart={(e) => drag.beginDrag(item, e)}
      onDragEnd={(e) => {
        e.currentTarget.draggable = false
        drag.endDrag()
      }}
      onDragOver={(e) => {
        if (!canDrop && !(e.dataTransfer.types.includes('Files') && item.kind === 'folder' && movable(item))) return
        e.preventDefault()
        e.dataTransfer.dropEffect = canDrop || e.dataTransfer.types.includes('Files') ? 'move' : 'none'
        drag.setOverId(item.id)
      }}
      onDragLeave={() => {
        if (drag.overId === item.id) drag.setOverId(null)
      }}
      onDrop={(e) => {
        if (item.kind !== 'folder' || !movable(item)) return
        drag.dropOn(item.id, e)
      }}
      className={cn(
        className,
        selected && 'bg-white/10 hover:bg-white/10',
        over && 'bg-white/15 ring-1 ring-white/40',
        drag.dragIds.includes(item.id) && 'opacity-50',
      )}
    >
      {children}
    </button>
  )
}

function handlers(props: FileViewProps & { onGetInfo: (item: DriveItem) => void }) {
  return {
    onOpen: props.onOpen,
    onGetInfo: props.onGetInfo,
    onStar: props.onStar,
    onShare: props.onShare,
    onRename: props.onRename,
    onTrash: props.onTrash,
    onRestore: props.onRestore,
    onDeleteForever: props.onDeleteForever,
    onRemoveShare: props.onRemoveShare,
    onDownload: props.onDownload,
    onUnzip: props.onUnzip,
    onMoveToTemp: props.onMoveToTemp,
    onKeep: props.onKeep,
    onCopy: props.onCopy,
    onAcceptShare: props.onAcceptShare,
    onVirusScan: props.onVirusScan,
    onSelect: props.onSelect,
    section: props.section,
  }
}

function when(item: DriveItem): string {
  if (item.expiresAt && !item.trashed) return formatRemaining(item.expiresAt)
  if (item.trashed && item.daysLeft != null) {
    if (item.daysLeft <= 0) return 'Expires today'
    return `${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'} left`
  }
  return formatDate(item.modifiedAt)
}

function Marks({ item, className }: { item: DriveItem; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {item.kind !== 'folder' || item.scanStatus ? <SafetyGauge score={item.safetyScore} status={item.scanStatus} signature={item.scanSignature} /> : null}
      {item.shared && item.owned !== false ? <Users className="size-3.5 text-[#8d8d8d]" /> : null}
      {item.starred ? <Star className="size-3.5 fill-[#fdd663] text-[#fdd663]" /> : null}
    </span>
  )
}

function ItemMenu({
  item,
  items,
  selectedIds,
  children,
  onOpen,
  onGetInfo,
  onStar,
  onShare,
  onRename,
  onTrash,
  onRestore,
  onDeleteForever,
  onRemoveShare,
  onDownload,
  onUnzip,
  onMoveToTemp,
  onKeep,
  onCopy,
  onAcceptShare,
  onVirusScan,
  onSelect,
  section,
}: {
  item: DriveItem
  items: DriveItem[]
  selectedIds: string[]
  children: ReactNode
  onOpen: (item: DriveItem) => void
  onGetInfo: (item: DriveItem) => void
  onStar: (ids: string[]) => void
  onShare: (id: string) => void
  onRename: (id: string) => void
  onTrash: (ids: string[]) => void
  onRestore: (ids: string[]) => void
  onDeleteForever: (ids: string[]) => void
  onRemoveShare: (id: string) => void
  onDownload: (items: DriveItem[]) => void
  onUnzip: (ids: string[]) => void
  onMoveToTemp: (ids: string[]) => void
  onKeep: (ids: string[]) => void
  onCopy: (ids: string[]) => void
  onAcceptShare: (id: string) => void
  onVirusScan: (ids: string[]) => void
  onSelect: (id: string, mods: SelectMods) => void
  section: SectionId
}) {
  const batch =
    selectedIds.includes(item.id) && selectedIds.length > 1
      ? items.filter((entry) => selectedIds.includes(entry.id))
      : [item]
  const n = batch.length
  const ids = batch.map((entry) => entry.id)
  const inbound = batch.every((entry) => entry.owned === false)
  const anyInbound = batch.some((entry) => entry.owned === false)
  const anyTrashed = batch.some((entry) => entry.trashed)
  const allTrashed = batch.every((entry) => entry.trashed)
  const shareRoot = n === 1 && item.owned === false && Boolean(item.shareId) && item.id === `share:${item.shareId}`
  const zips = batch.filter((entry) => !entry.trashed && entry.owned !== false && isZipName(entry.name))
  const inTemp = batch.every((entry) => isTempId(entry.id))
  const canTemp = batch.every((entry) => !isTempId(entry.id) && entry.owned !== false && !entry.trashed && !entry.computer)
  const allStarred = batch.every((entry) => entry.starred)
  const huge = batch.some((entry) => entry.size != null && entry.size > 20 * 1024 ** 3)
  const spam = section === 'spam' || batch.every((entry) => entry.spam)
  const canCopy = batch.every((entry) => entry.owned !== false && !entry.trashed && !entry.spam && !entry.computer)
  const canVirusScan = batch.every((entry) => entry.kind !== 'folder' && !entry.trashed && !entry.spam && !entry.computer)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-drive-item
          className="min-w-0"
          onContextMenu={() => {
            if (!selectedIds.includes(item.id)) onSelect(item.id, { toggle: false, range: false })
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {spam ? (
          <>
            {n === 1 ? (
              <ContextMenuItem onSelect={() => onGetInfo(item)}>
                <Info />
                Get Info
              </ContextMenuItem>
            ) : null}
            {n === 1 ? (
              <ContextMenuItem onSelect={() => onAcceptShare(item.id)}>
                <Check />
                Accept
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem variant="destructive" onSelect={() => onRemoveShare(item.id)}>
              <UserMinus />
              Remove
            </ContextMenuItem>
          </>
        ) : (
          <>
        {n === 1 ? (
          <ContextMenuItem onSelect={() => onOpen(item)}>
            <FolderOpen />
            Open
          </ContextMenuItem>
        ) : null}
        {n === 1 ? (
          <ContextMenuItem onSelect={() => onGetInfo(item)}>
            <Info />
            Get Info
          </ContextMenuItem>
        ) : null}
        {n === 1 && !inbound ? (
          <ContextMenuItem onSelect={() => onShare(item.id)}>
            <Share2 />
            Share
          </ContextMenuItem>
        ) : null}
        {anyInbound || anyTrashed ? null : (
          <ContextMenuItem onSelect={() => onStar(ids)}>
            <Star />
            {allStarred ? (n > 1 ? `Remove star from ${n} items` : 'Remove star') : n > 1 ? `Star ${n} items` : 'Add to starred'}
          </ContextMenuItem>
        )}
        {n === 1 && !inbound && !item.trashed ? (
          <ContextMenuItem onSelect={() => onRename(item.id)}>
            <Pencil />
            Rename
          </ContextMenuItem>
        ) : null}
        {canCopy ? (
          <ContextMenuItem onSelect={() => onCopy(ids)}>
            <Copy />
            {n > 1 ? `Make ${n} copies` : 'Make a copy'}
          </ContextMenuItem>
        ) : null}
        {zips.length ? (
          <ContextMenuItem onSelect={() => onUnzip(zips.map((entry) => entry.id))}>
            <ArchiveRestore />
            {zips.length > 1 ? `Unzip ${zips.length} items` : 'Unzip'}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => onDownload(batch)}>
          <Download />
          {n > 1 ? `Download ${n} items` : 'Download'}
        </ContextMenuItem>
        {canVirusScan ? (
          <ContextMenuItem onSelect={() => onVirusScan(ids)}>
            <ShieldCheck />
            {n > 1 ? `Check ${n} files for viruses` : 'Check for viruses'}
          </ContextMenuItem>
        ) : null}
        {anyInbound || anyTrashed || batch.some((entry) => entry.computer) ? null : inTemp ? (
          <ContextMenuItem onSelect={() => onKeep(ids)}>
            <HardDrive />
            {n > 1 ? `Keep ${n} in My files` : 'Keep in My files'}
          </ContextMenuItem>
        ) : canTemp ? (
          <ContextMenuItem onSelect={() => onMoveToTemp(ids)}>
            <Timer />
            {n > 1 ? `Move ${n} to Temp` : 'Move to Temp'}
          </ContextMenuItem>
        ) : null}
        {allTrashed || shareRoot || (!anyInbound && !anyTrashed) ? <ContextMenuSeparator /> : null}
        {allTrashed ? (
          <>
            <ContextMenuItem onSelect={() => onRestore(ids)}>
              <Undo2 />
              {n > 1 ? `Restore ${n} items` : 'Restore'}
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => onDeleteForever(ids)}>
              <Trash2 />
              {n > 1 ? `Delete ${n} forever` : 'Delete forever'}
            </ContextMenuItem>
          </>
        ) : inbound ? (
          shareRoot ? (
            <ContextMenuItem onSelect={() => onRemoveShare(item.id)}>
              <UserMinus />
              Remove
            </ContextMenuItem>
          ) : null
        ) : anyInbound ? null : (
          <ContextMenuItem variant="destructive" onSelect={() => onTrash(ids)}>
            <Trash2 />
            {n > 1
              ? huge
                ? `Delete ${n} items`
                : `Move ${n} to trash`
              : huge
                ? 'Delete permanently'
                : 'Move to trash'}
          </ContextMenuItem>
        )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function EmptyState({ section, search }: { section: SectionId; search: string }) {
  let title = 'This folder is empty'
  let body = 'Right-click for new file, folder, or upload. Drag items into folders to organize.'

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
    body = 'First-time shares from people you have not accepted yet land here. Accept to move them into Shared with me, or remove them.'
  } else if (section === 'recent') {
    title = 'No recent files'
    body = 'Open something and it will show up in this list.'
  } else if (section === 'temp') {
    title = 'Temp is empty'
    body = 'Files here delete on the timer you set. Upload, or move something from My files.'
  }

  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <FileGlyph kind="folder" size="lg" />
      <h2 className="mt-4 text-lg font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[#8d8d8d]">{body}</p>
    </div>
  )
}
