import { FileGlyph } from '@/components/FileGlyph'
import { FileView } from '@/components/FileView'
import { Settings, type SettingsSection } from '@/components/Settings'
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
import {
  downloadUrl,
  initials,
  listFiles,
  logout,
  mkdir,
  renameFile,
  restoreFile,
  starFile,
  toDriveItem,
  trashFile,
  uploadFile,
  type FileEntry,
} from '@/lib/api'
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
  const [section, setSection] = useState<SectionId>('home')
  const [folderPath, setFolderPath] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>(account.defaultView === 'list' ? 'list' : 'grid')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'rename'; id?: string }>(null)
  const [nameDraft, setNameDraft] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(t)
  }, [toast])

  const crumbs = useMemo(() => {
    if (!folderPath) return []
    const parts = folderPath.split('/')
    return parts.map((name, i) => ({
      id: parts.slice(0, i + 1).join('/'),
      name,
    }))
  }, [folderPath])

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
      } else if (section === 'shared' || section === 'spam') {
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
    setSidebarOpen(false)
  }

  function goSection(id: SectionId) {
    setSection(id)
    setFolderPath('')
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
      if (item.computer) {
        setSection('my-drive')
        setFolderPath('')
        setSelectedIds([])
        setSearch('')
        return
      }
      setSection('my-drive')
      setFolderPath(item.id)
      setSelectedIds([])
      setSearch('')
      return
    }
    window.open(downloadUrl(item.id), '_blank')
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

  async function trash(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    try {
      await trashFile(id)
      setSelectedIds((current) => current.filter((x) => x !== id))
      notify(`Moved ${item.name} to trash`)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not trash')
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

  function share(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    void navigator.clipboard?.writeText(`${window.location.origin}${downloadUrl(item.id)}`)
    notify(`Link copied for ${item.name} — only works if you’re signed in`)
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
        files={items}
        account={profile}
        initials={me.ownerInitials}
        settingsOpen={settingsOpen}
        onSearch={setSearch}
        onView={setView}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenSettings={openSettings}
        onSignOut={() => void signOut()}
      />
      {settingsOpen ? (
        <Settings
          account={{ ...account, ...profile }}
          initialSection={settingsSection}
          onClose={() => setSettingsOpen(false)}
          onAccount={(next) => setProfile(next)}
          onPlatform={(next) => setView(next.defaultView)}
          onToast={notify}
        />
      ) : (
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
          onCreateFile={(kind) => void createUntitled(kind)}
          onUpload={() => uploadRef.current?.click()}
          onOpenSettings={() => openSettings(account.role === 'admin' ? 'storage' : 'account')}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#1a1a1a]">
          <div
            className="flex flex-col gap-6 overflow-y-auto px-4 py-4 md:px-6 md:py-5"
            onClick={() => setSelectedIds([])}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {folderPath && !search.trim() ? (
                <>
                  <button type="button" className="hover:text-foreground" onClick={() => goSection('my-drive')}>
                    My files
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
                <h1 className="text-2xl font-normal tracking-tight text-foreground">{heading}</h1>
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
                onSelect={select}
                onOpen={openItem}
                onStar={(id) => void star(id)}
                onShare={share}
                onRename={openRename}
                onTrash={(id) => void trash(id)}
                onRestore={(id) => void restore(id)}
                onDownload={(item) => {
                  window.open(downloadUrl(item.id), '_blank')
                }}
              />
            )}
          </div>
        </main>
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
            <DialogTitle>{dialog?.mode === 'rename' ? 'Rename' : 'New folder'}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'rename'
                ? 'Update the file name. Extension stays yours to keep or drop.'
                : 'Folders live in the current location.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={nameDraft}
            placeholder="Untitled folder"
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

      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#e3e3e3] px-4 py-2.5 text-sm font-medium text-[#1a1a1a] shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
