import { FileGlyph } from '@/components/FileGlyph'
import { FilePreview } from '@/components/FilePreview'
import { FileView, type SortKey } from '@/components/FileView'
import { Settings, type SettingsSection } from '@/components/Settings'
import { ShareDialog } from '@/components/ShareDialog'
import { Sidebar } from '@/components/Sidebar'
import { Terminals } from '@/components/Terminals'
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
import {
  ApiError,
  HARD_DELETE_BYTES,
  deleteFile,
  deleteShare,
  downloadUrl,
  emptyTrash,
  initials,
  listFiles,
  logout,
  mkdir,
  parseSharePath,
  rawUrl,
  renameFile,
  restoreFile,
  starFile,
  toDriveItem,
  trashFile,
  unzipFile,
  uploadFile,
  type FileEntry,
} from '@/lib/api'
import { formatBytes } from '@/lib/format'
import type { DriveItem, FileKind, SectionId } from '@/types'
import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

type Account = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  reservedBytes: number
  usedBytes: number
  host: string
  defaultView?: 'grid' | 'list'
  terminalsEnabled?: boolean
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

export default function App({ account, onSignedOut }: { account: Account; onSignedOut: () => void }) {
  const quota = account.reservedBytes > 0 ? account.reservedBytes : 100 * 1024 ** 3
  const [items, setItems] = useState<DriveItem[]>([])
  const [suggested, setSuggested] = useState<DriveItem[]>([])
  const [usedBytes, setUsedBytes] = useState(account.usedBytes)
  const [host, setHost] = useState(account.host)
  const [profile, setProfile] = useState({ name: account.name, email: account.email })
  const me = { owner: profile.name, ownerInitials: initials(profile.name) }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account')
  const [terminalsOpen, setTerminalsOpen] = useState(false)
  const [terminalsEnabled, setTerminalsEnabled] = useState(account.terminalsEnabled !== false)
  const [section, setSection] = useState<SectionId>('home')
  const [folderPath, setFolderPath] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>(account.defaultView === 'list' ? 'list' : 'grid')
  const [sort, setSort] = useState<SortKey>('name')
  const [preview, setPreview] = useState<DriveItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'create-file' | 'rename'; id?: string }>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [shareLabel, setShareLabel] = useState('Shared')
  const [shareTarget, setShareTarget] = useState<DriveItem | null>(null)
  const [confirm, setConfirm] = useState<
    null | { mode: 'permanent'; id: string; name: string; size: number } | { mode: 'empty-trash' } | { mode: 'delete-forever'; id: string; name: string }
  >(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(t)
  }, [toast])

  const crumbs = useMemo(() => {
    if (!folderPath) return []
    const shared = parseSharePath(folderPath)
    if (shared) {
      const root = { id: `share:${shared.shareId}`, name: shareLabel || 'Shared' }
      if (!shared.sub) return [root]
      const parts = shared.sub.split('/')
      return [
        root,
        ...parts.map((name, i) => ({
          id: `share:${shared.shareId}/${parts.slice(0, i + 1).join('/')}`,
          name,
        })),
      ]
    }
    const parts = folderPath.split('/')
    return parts.map((name, i) => ({
      id: parts.slice(0, i + 1).join('/'),
      name,
    }))
  }, [folderPath, shareLabel])

  const refresh = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      const q = search.trim()
      let entries: FileEntry[]
      if (q) {
        entries = await listFiles({ view: 'search', q })
      } else if (section === 'trash') {
        entries = await listFiles({ view: 'trash' })
      } else if (section === 'starred') {
        entries = await listFiles({ view: 'starred' })
      } else if (section === 'recent' || section === 'home') {
        entries = await listFiles({ view: 'recent' })
      } else if (section === 'shared') {
        const shared = parseSharePath(folderPath)
        if (shared) {
          entries = await listFiles({ view: 'shared', share: shared.shareId, path: shared.sub })
          if (entries[0]?.shareName) setShareLabel(entries[0].shareName)
        } else {
          entries = await listFiles({ view: 'shared' })
        }
      } else if (section === 'spam') {
        entries = []
      } else if (section === 'computers' && !folderPath) {
        entries = []
      } else {
        entries = await listFiles({ path: folderPath })
      }
      setItems(entries.map((entry) => toDriveItem(entry, { name: profile.name })))
      if (section === 'home' && !q) {
        const root = await listFiles({ path: '' })
        setSuggested(
          root.filter((entry) => entry.type === 'folder').slice(0, 8).map((entry) => toDriveItem(entry, { name: profile.name })),
        )
        if (entries.length === 0) {
          const files = root.filter((entry) => entry.type === 'file')
          setItems(files.map((entry) => toDriveItem(entry, { name: profile.name })))
        }
      } else {
        setSuggested([])
      }
      const status = await fetch('/api/status', { credentials: 'include' }).then(
        (res) => res.json() as Promise<{ usedBytes?: number; host?: string }>,
      )
      if (typeof status.usedBytes === 'number') setUsedBytes(status.usedBytes)
      if (status.host) setHost(status.host)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load files')
    } finally {
      setLoading(false)
    }
  }, [folderPath, profile.name, search, section])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function notify(message: string) {
    setToast(message)
  }

  function openSettings(section: SettingsSection = 'account') {
    const next = account.role === 'admin' || section === 'account' ? section : 'account'
    setSettingsSection(next)
    setSettingsOpen(true)
    setTerminalsOpen(false)
    setSidebarOpen(false)
  }

  function openTerminals() {
    if (!terminalsEnabled) return
    setTerminalsOpen(true)
    setSettingsOpen(false)
    setSidebarOpen(false)
  }

  useEffect(() => {
    if (!terminalsEnabled) setTerminalsOpen(false)
  }, [terminalsEnabled])

  function goSection(id: SectionId) {
    setSection(id)
    setFolderPath('')
    setSelectedIds([])
    setSearch('')
    setSettingsOpen(false)
    setTerminalsOpen(false)
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
      if (item.computer) {
        setSection('my-drive')
        setFolderPath('')
        setSelectedIds([])
        setSearch('')
        return
      }
      if (item.shareName) setShareLabel(item.shareName)
      setSection(item.id.startsWith('share:') ? 'shared' : 'my-drive')
      setFolderPath(item.id)
      setSelectedIds([])
      setSearch('')
      return
    }
    setPreview(item)
  }

  async function star(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    try {
      await starFile(id, !item.starred)
      notify(item.starred ? `Removed star from ${item.name}` : `Starred ${item.name}`)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not star')
    }
  }

  async function trash(id: string, confirmed = false) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    if (!confirmed && item.size != null && item.size > HARD_DELETE_BYTES) {
      setConfirm({ mode: 'permanent', id, name: item.name, size: item.size })
      return
    }
    try {
      const result = await trashFile(id, confirmed)
      setSelectedIds((current) => current.filter((x) => x !== id))
      notify(result.permanent ? `Deleted ${item.name} permanently` : `Moved ${item.name} to trash`)
      await refresh()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PERMANENT_DELETE') {
        setConfirm({ mode: 'permanent', id, name: item.name, size: err.size ?? item.size ?? 0 })
        return
      }
      notify(err instanceof Error ? err.message : 'Could not trash')
    }
  }

  async function removeForever(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    try {
      await deleteFile(id)
      setSelectedIds((current) => current.filter((x) => x !== id))
      notify(`Deleted ${item.name}`)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  async function wipeTrash() {
    try {
      await emptyTrash()
      notify('Trash emptied')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not empty trash')
    }
  }

  async function removeShare(id: string) {
    const parsed = parseSharePath(id)
    if (!parsed) return
    try {
      await deleteShare(parsed.shareId)
      notify('Removed from Shared with me')
      setFolderPath('')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove')
    }
  }

  async function restore(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    try {
      await restoreFile(id)
      notify(`Restored ${item.name}`)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not restore')
    }
  }

  async function unzip(id: string) {
    try {
      await unzipFile(id)
      notify('Unzipped')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not unzip')
    }
  }

  function share(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item || item.owned === false) return
    setShareTarget(item)
  }

  function openRename(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    setNameDraft(item.name)
    setDialog({ mode: 'rename', id })
  }

  async function submitDialog() {
    const name = nameDraft.trim()
    if (!name) return
    try {
      if (dialog?.mode === 'create') {
        const path = joinPath(section === 'my-drive' ? folderPath : '', name)
        await mkdir(path)
        notify(`Created ${name}`)
      }
      if (dialog?.mode === 'create-file') {
        const dir = section === 'my-drive' || section === 'home' ? (section === 'my-drive' ? folderPath : '') : ''
        await uploadFile(dir, new File([''], name))
        notify(`Created ${name}`)
      }
      if (dialog?.mode === 'rename' && dialog.id) {
        await renameFile(dialog.id, name)
        notify(`Renamed to ${name}`)
      }
      setDialog(null)
      setNameDraft('')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save')
    }
  }

  async function createUntitled(kind: FileKind) {
    const names: Record<FileKind, string> = {
      folder: 'Untitled folder',
      doc: 'Untitled document.txt',
      sheet: 'Untitled spreadsheet.csv',
      slide: 'Untitled presentation.txt',
      pdf: 'Untitled.pdf',
      image: 'Untitled.txt',
      video: 'Untitled.txt',
      audio: 'Untitled.txt',
      zip: 'Untitled.txt',
    }
    const dir = section === 'computers' ? '' : folderPath
    try {
      if (kind === 'folder') {
        await mkdir(joinPath(dir, names.folder))
      } else {
        await uploadFile(dir, new File([''], names[kind]))
      }
      setSection('my-drive')
      notify(`Created ${names[kind]}`)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create')
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return
    const dir = section === 'computers' ? '' : folderPath
    try {
      for (const file of Array.from(files)) {
        await uploadFile(dir, file)
      }
      setSection('my-drive')
      notify(files.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${files.length} files`)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  async function signOut() {
    await logout()
    onSignedOut()
  }

  const computerItem: DriveItem | null =
    section === 'computers' && !folderPath && !search.trim()
      ? {
          id: '__node__',
          name: host || 'This node',
          kind: 'folder',
          parentId: null,
          owner: profile.name,
          ownerInitials: me.ownerInitials,
          modifiedAt: new Date().toISOString(),
          size: null,
          starred: false,
          shared: false,
          trashed: false,
          spam: false,
          computer: true,
        }
      : null

  const visible = computerItem ? [computerItem] : items
  const heading = search.trim()
    ? `Results for "${search.trim()}"`
    : folderPath
      ? crumbs[crumbs.length - 1]?.name ?? titles[section]
      : titles[section]

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1a1a1a] text-foreground">
      <TopBar
        search={search}
        view={view}
        account={profile}
        initials={me.ownerInitials}
        settingsOpen={settingsOpen}
        terminalsOpen={terminalsOpen}
        terminalsEnabled={terminalsEnabled}
        onSearch={setSearch}
        onView={setView}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenSettings={openSettings}
        onOpenTerminals={openTerminals}
        onSignOut={() => void signOut()}
      />
      {settingsOpen ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Settings
            account={{ ...account, ...profile }}
            initialSection={settingsSection}
            onClose={() => setSettingsOpen(false)}
            onAccount={(next) => setProfile(next)}
            onPlatform={(next) => {
              if (next.defaultView) setView(next.defaultView)
              if (next.terminalsEnabled !== undefined) setTerminalsEnabled(next.terminalsEnabled)
            }}
            onToast={notify}
          />
        </div>
      ) : (
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#1a1a1a]">
        <Sidebar
          section={section}
          terminalsOpen={terminalsOpen}
          terminalsEnabled={terminalsEnabled}
          usedBytes={usedBytes}
          quotaBytes={quota}
          mobileOpen={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
          onSection={goSection}
          onNewFolder={() => {
            setNameDraft('')
            setDialog({ mode: 'create' })
          }}
          onCreateFile={(kind) => void createUntitled(kind)}
          onUpload={() => uploadRef.current?.click()}
          onOpenSettings={() => openSettings(account.role === 'admin' ? 'storage' : 'account')}
          onOpenTerminals={openTerminals}
        />
        {terminalsOpen ? (
          <Terminals onToast={notify} onDisabled={() => setTerminalsEnabled(false)} />
        ) : (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#1a1a1a]">
          <div
            className="flex flex-col gap-6 overflow-y-auto px-4 py-4 md:px-6 md:py-5"
            onClick={() => setSelectedIds([])}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {folderPath && !search.trim() ? (
                <>
                  <button
                    type="button"
                    className="hover:text-foreground"
                    onClick={() => goSection(section === 'shared' ? 'shared' : 'my-drive')}
                  >
                    {section === 'shared' ? 'Shared with me' : 'My files'}
                  </button>
                  {crumbs.map((crumb, i) => (
                    <span key={crumb.id} className="flex items-center gap-2">
                      <ChevronRight className="size-4" />
                      <button
                        type="button"
                        className={i === crumbs.length - 1 ? 'font-medium text-foreground' : 'hover:text-foreground'}
                        onClick={() => {
                          setFolderPath(crumb.id)
                          setSelectedIds([])
                        }}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </>
              ) : (
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <h1 className="text-2xl font-normal tracking-tight text-foreground">{heading}</h1>
                  {section === 'trash' && items.length > 0 ? (
                    <Button
                      variant="ghost"
                      className="h-9 rounded-full text-[#f28b82] hover:bg-white/5 hover:text-[#f28b82]"
                      onClick={() => setConfirm({ mode: 'empty-trash' })}
                    >
                      Empty trash
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            {loadError ? <p className="text-sm text-[#f28b82]">{loadError}</p> : null}

            {section === 'home' && !search.trim() && suggested.length > 0 ? (
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

            {loading && items.length === 0 && !computerItem ? (
              <p className="text-sm text-[#8d8d8d]">Loading your files…</p>
            ) : (
              <FileView
                items={visible}
                view={view}
                section={section}
                selectedIds={selectedIds}
                search={search}
                sort={sort}
                onSort={setSort}
                onView={setView}
                canCreate={!search.trim() && (section === 'my-drive' || section === 'home') && !folderPath.startsWith('share:')}
                onNewFolder={() => {
                  setNameDraft('')
                  setDialog({ mode: 'create' })
                }}
                onNewFile={() => {
                  setNameDraft('untitled.txt')
                  setDialog({ mode: 'create-file' })
                }}
                onUpload={() => uploadRef.current?.click()}
                onSelect={select}
                onOpen={openItem}
                onStar={(id) => void star(id)}
                onShare={share}
                onRename={openRename}
                onTrash={(id) => void trash(id)}
                onRestore={(id) => void restore(id)}
                onDeleteForever={(id) => {
                  const item = items.find((entry) => entry.id === id)
                  if (!item) return
                  setConfirm({ mode: 'delete-forever', id, name: item.name })
                }}
                onRemoveShare={(id) => void removeShare(id)}
                onDownload={(item) => {
                  window.open(downloadUrl(item.id), '_blank')
                }}
                onUnzip={(id) => void unzip(id)}
              />
            )}
          </div>
        </main>
        )}
      </div>
      )}

      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void onUpload(e.target.files)
          e.target.value = ''
        }}
      />

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'rename' ? 'Rename' : dialog?.mode === 'create-file' ? 'New file' : 'New folder'}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'rename'
                ? 'Update the file name. Extension stays yours to keep or drop.'
                : dialog?.mode === 'create-file'
                  ? 'Created in this folder. Use an extension like .txt or .py.'
                  : 'Folders live in the current location.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={nameDraft}
            placeholder={dialog?.mode === 'create-file' ? 'notes.txt' : 'Untitled folder'}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitDialog()
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitDialog()} disabled={!nameDraft.trim()}>
              {dialog?.mode === 'rename' ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {preview ? (
        <FilePreview
          name={preview.name}
          url={rawUrl(preview.id)}
          downloadUrl={downloadUrl(preview.id)}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {shareTarget ? (
        <ShareDialog
          path={shareTarget.id}
          name={shareTarget.name}
          onClose={() => {
            setShareTarget(null)
            void refresh()
          }}
          onToast={notify}
        />
      ) : null}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.mode === 'empty-trash'
                ? 'Empty trash?'
                : confirm?.mode === 'delete-forever'
                  ? 'Delete forever?'
                  : 'No trash for this file'}
            </DialogTitle>
            <DialogDescription>
              {confirm?.mode === 'empty-trash'
                ? 'Everything in trash is deleted now. This cannot be undone.'
                : confirm?.mode === 'delete-forever'
                  ? `${confirm.name} leaves trash and is gone.`
                  : confirm?.mode === 'permanent'
                    ? `${confirm.name} is ${formatBytes(confirm.size)}. Files over 20 GB skip the 30-day trash and are deleted immediately.`
                    : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="bg-[#c5221f] text-white hover:bg-[#a50e0e]"
              onClick={() => {
                const next = confirm
                setConfirm(null)
                if (next?.mode === 'empty-trash') void wipeTrash()
                if (next?.mode === 'delete-forever') void removeForever(next.id)
                if (next?.mode === 'permanent') void trash(next.id, true)
              }}
            >
              Delete
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
