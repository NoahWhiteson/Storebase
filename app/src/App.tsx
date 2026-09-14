import { FileGlyph } from '@/components/FileGlyph'
import { FileView } from '@/components/FileView'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { initialItems } from '@/data/files'
import type { DriveItem, FileKind, SectionId } from '@/types'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

const titles: Record<SectionId, string> = {
  home: 'Welcome to Storebase',
  'my-drive': 'My files',
  computers: 'Computers',
  shared: 'Shared with me',
  recent: 'Recent',
  starred: 'Starred',
  spam: 'Spam',
  trash: 'Trash',
}

function kindFromName(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'aac'].includes(ext)) return 'audio'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet'
  if (['ppt', 'pptx'].includes(ext)) return 'slide'
  if (ext === 'pdf') return 'pdf'
  if (['zip', 'rar', '7z'].includes(ext)) return 'zip'
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return 'doc'
  return 'doc'
}

type Account = {
  name: string
  email: string
  reservedBytes: number
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export default function App({ account }: { account: Account }) {
  const me = { owner: account.name, ownerInitials: initials(account.name) }
  const quota = account.reservedBytes > 0 ? account.reservedBytes : 100 * 1024 ** 3
  const [items, setItems] = useState<DriveItem[]>(initialItems)
  const [section, setSection] = useState<SectionId>('home')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'rename'; id?: string }>(null)
  const [nameDraft, setNameDraft] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(t)
  }, [toast])

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const crumbs = useMemo(() => {
    const path: DriveItem[] = []
    let cursor = folderId
    while (cursor) {
      const node = byId.get(cursor)
      if (!node) break
      path.unshift(node)
      cursor = node.parentId
    }
    return path
  }, [byId, folderId])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = items.filter((item) => {
      if (q) {
        if (item.trashed || item.spam) return false
        return item.name.toLowerCase().includes(q)
      }
      if (section === 'trash') return item.trashed
      if (section === 'spam') return item.spam && !item.trashed
      if (item.trashed || item.spam) return false
      if (section === 'starred') return item.starred
      if (section === 'shared') return item.shared && item.owner !== me.owner
      if (section === 'recent') return item.kind !== 'folder'
      if (section === 'computers') {
        if (folderId) return item.parentId === folderId
        return item.computer && item.parentId === null
      }
      if (section === 'home') return item.kind !== 'folder' && !item.computer
      if (section === 'my-drive') {
        if (item.computer) return false
        if (item.parentId !== folderId) return false
        return folderId !== null || item.owner === me.owner
      }
      return item.parentId === folderId
    })

    if (section === 'recent' || section === 'home') {
      list = [...list].sort((a, b) => +new Date(b.modifiedAt) - +new Date(a.modifiedAt)).slice(0, 18)
    } else {
      list = [...list].sort((a, b) => {
        if (a.kind === 'folder' && b.kind !== 'folder') return -1
        if (a.kind !== 'folder' && b.kind === 'folder') return 1
        return a.name.localeCompare(b.name)
      })
    }
    return list
  }, [folderId, items, me.owner, search, section])

  const suggested = useMemo(
    () => items.filter((item) => item.kind === 'folder' && !item.trashed && !item.spam && !item.computer && item.parentId === null).slice(0, 4),
    [items],
  )

  const usedBytes = items.reduce((sum, item) => (item.trashed ? sum : sum + (item.size ?? 0)), 0)

  function notify(message: string) {
    setToast(message)
  }

  function goSection(id: SectionId) {
    setSection(id)
    setFolderId(null)
    setSelectedIds([])
    setSearch('')
    setSidebarOpen(false)
  }

  function select(id: string, additive: boolean) {
    setSelectedIds((current) => {
      if (additive) {
        return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
      }
      return current.length === 1 && current[0] === id ? current : [id]
    })
  }

  function openItem(item: DriveItem) {
    if (item.trashed) {
      notify('Restore this item to open it')
      return
    }
    if (item.kind === 'folder') {
      setSection(item.computer ? 'computers' : 'my-drive')
      setFolderId(item.id)
      setSelectedIds([])
      setSearch('')
      return
    }
    notify(`Opening ${item.name}`)
  }

  function patch(id: string, update: Partial<DriveItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)))
  }

  function star(id: string) {
    const item = byId.get(id)
    if (!item) return
    patch(id, { starred: !item.starred })
    notify(item.starred ? `Removed star from ${item.name}` : `Starred ${item.name}`)
  }

  function trash(id: string) {
    const item = byId.get(id)
    if (!item) return
    patch(id, { trashed: true, starred: false })
    setSelectedIds((current) => current.filter((x) => x !== id))
    notify(`Moved ${item.name} to trash`)
  }

  function restore(id: string) {
    const item = byId.get(id)
    if (!item) return
    patch(id, { trashed: false, spam: false })
    notify(`Restored ${item.name}`)
  }

  function share(id: string) {
    const item = byId.get(id)
    if (!item) return
    patch(id, { shared: true })
    notify(`Link copied for ${item.name}`)
  }

  function openRename(id: string) {
    const item = byId.get(id)
    if (!item) return
    setNameDraft(item.name)
    setDialog({ mode: 'rename', id })
  }

  function submitDialog() {
    const name = nameDraft.trim()
    if (!name) return
    if (dialog?.mode === 'create') {
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const parent = section === 'my-drive' || section === 'computers' ? folderId : null
      setItems((current) => [
        {
          id,
          name,
          kind: 'folder',
          parentId: parent,
          ...me,
          modifiedAt: now,
          size: null,
          starred: false,
          shared: false,
          trashed: false,
          spam: false,
          computer: section === 'computers',
        },
        ...current,
      ])
      notify(`Created ${name}`)
    }
    if (dialog?.mode === 'rename' && dialog.id) {
      patch(dialog.id, { name, modifiedAt: new Date().toISOString() })
      notify(`Renamed to ${name}`)
    }
    setDialog(null)
    setNameDraft('')
  }

  function createUntitled(kind: FileKind) {
    const names: Record<FileKind, string> = {
      folder: 'Untitled folder',
      doc: 'Untitled document',
      sheet: 'Untitled spreadsheet',
      slide: 'Untitled presentation',
      pdf: 'Untitled.pdf',
      image: 'Untitled image',
      video: 'Untitled video',
      audio: 'Untitled audio',
      zip: 'Untitled.zip',
    }
    const now = new Date().toISOString()
    const parent = section === 'my-drive' || section === 'computers' ? folderId : null
    const created: DriveItem = {
      id: crypto.randomUUID(),
      name: names[kind],
      kind,
      parentId: parent,
      ...me,
      modifiedAt: now,
      size: kind === 'folder' ? null : 0,
      starred: false,
      shared: false,
      trashed: false,
      spam: false,
      computer: section === 'computers',
    }
    setItems((current) => [created, ...current])
    setSection(section === 'computers' ? 'computers' : 'my-drive')
    setSelectedIds([created.id])
    notify(`Created ${created.name}`)
  }

  function onUpload(files: FileList | null) {
    if (!files?.length) return
    const now = new Date().toISOString()
    const parent = section === 'my-drive' || section === 'computers' ? folderId : null
    const next: DriveItem[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      kind: kindFromName(file.name),
      parentId: parent,
      ...me,
      modifiedAt: now,
      size: file.size,
      starred: false,
      shared: false,
      trashed: false,
      spam: false,
      computer: section === 'computers',
    }))
    setItems((current) => [...next, ...current])
    setSection(parent ? (section === 'computers' ? 'computers' : 'my-drive') : 'my-drive')
    notify(next.length === 1 ? `Uploaded ${next[0].name}` : `Uploaded ${next.length} files`)
  }

  const heading =
    search.trim() ? `Results for "${search.trim()}"` : folderId ? crumbs[crumbs.length - 1]?.name ?? titles[section] : titles[section]

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1a1a1a] text-foreground">
      <TopBar
        search={search}
        view={view}
        files={items}
        account={account}
        initials={me.ownerInitials}
        onSearch={setSearch}
        onView={setView}
        onOpenSidebar={() => setSidebarOpen(true)}
      />
      <div className="flex min-h-0 flex-1 bg-[#1a1a1a]">
        <Sidebar
          section={section}
          usedBytes={usedBytes}
          quotaBytes={quota}
          mobileOpen={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
          onSection={goSection}
          onNewFolder={() => {
            setNameDraft('')
            setDialog({ mode: 'create' })
          }}
          onCreateFile={createUntitled}
          onUpload={() => uploadRef.current?.click()}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#1a1a1a]">
          <div
            className="flex flex-col gap-6 overflow-y-auto px-4 py-4 md:px-6 md:py-5"
            onClick={() => setSelectedIds([])}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {folderId && !search.trim() ? (
                <>
                  <button
                    type="button"
                    className="hover:text-foreground"
                    onClick={() => goSection(section === 'computers' ? 'computers' : 'my-drive')}
                  >
                    {section === 'computers' ? 'Computers' : 'My files'}
                  </button>
                  {crumbs.map((crumb, i) => (
                    <span key={crumb.id} className="flex items-center gap-2">
                      <ChevronRight className="size-4" />
                      <button
                        type="button"
                        className={i === crumbs.length - 1 ? 'font-medium text-foreground' : 'hover:text-foreground'}
                        onClick={() => {
                          setFolderId(crumb.id)
                          setSelectedIds([])
                        }}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </>
              ) : (
                <h1 className="text-2xl font-normal tracking-tight text-foreground">{heading}</h1>
              )}
            </div>

            {section === 'home' && !search.trim() ? (
              <section>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">Suggested folders</h2>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {suggested.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => openItem(folder)}
                      className="flex min-w-[200px] items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5"
                    >
                      <FileGlyph kind="folder" size="sm" />
                      <span className="truncate text-sm">{folder.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {section === 'home' && !search.trim() ? (
              <h2 className="text-sm font-medium text-muted-foreground">Files</h2>
            ) : null}

            <FileView
              items={visible}
              view={view}
              section={section}
              selectedIds={selectedIds}
              search={search}
              onSelect={select}
              onOpen={openItem}
              onStar={star}
              onShare={share}
              onRename={openRename}
              onTrash={trash}
              onRestore={restore}
            />
          </div>
        </main>
      </div>

      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onUpload(e.target.files)
          e.target.value = ''
        }}
      />

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'rename' ? 'Rename' : 'New folder'}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'rename' ? 'Update the file name. Extension stays yours to keep or drop.' : 'Folders live in the current location.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={nameDraft}
            placeholder="Untitled folder"
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitDialog()
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={submitDialog} disabled={!nameDraft.trim()}>
              {dialog?.mode === 'rename' ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#e3e3e3] px-4 py-2.5 text-sm font-medium text-[#1a1a1a] shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
