import { beginOperation, runBatch } from '@/lib/operations'
import { OperationPanel } from '@/components/OperationPanel'
import { AlertBanner } from '@/components/AlertBanner'
import { FilePreview } from '@/components/FilePreview'
import { FileView, sortItems, type SortKey } from '@/components/FileView'
import { Settings, Terminals, type SettingsSection } from '@/components/DeferredPanels'
import { ShareDialog } from '@/components/ShareDialog'
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
  ApiError,
  HARD_DELETE_BYTES,
  acceptShare,
  copyFiles,
  deleteFile,
  deleteShare,
  downloadUrl,
  emptyTrash,
  fetchAlerts,
  fetchTempSettings,
  initials,
  isTempId,
  keepFromTemp,
  listFiles,
  logout,
  mkdir,
  moveFiles,
  moveToTemp,
  parseSharePath,
  rawUrl,
  renameFile,
  restoreFile,
  saveContent,
  saveOriginal,
  setTempTtl,
  starFile,
  toDriveItem,
  trashFile,
  unzipFile,
  uploadFile,
  type FileEntry,
  type SystemAlert,
} from '@/lib/api'
import { formatTtl } from '@/lib/format'
import type { DriveItem, FileKind, SectionId } from '@/types'
import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, type DragEvent } from 'react'

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

const TTL_PRESETS = [
  { label: '1 hour', hours: 1 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
]

function tempDir(folderPath: string): string {
  return folderPath && folderPath !== '.temp' ? folderPath : '.temp'
}

function itemsMatch(a: DriveItem[], b: DriveItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => {
    const other = b[i]
    return (
      !!other &&
      item.id === other.id &&
      item.name === other.name &&
      item.modifiedAt === other.modifiedAt &&
      item.size === other.size &&
      item.starred === other.starred &&
      item.trashed === other.trashed &&
      item.shared === other.shared &&
      item.spam === other.spam
    )
  })
}

type Account = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  reservedBytes: number
  usedBytes: number
  quotaBytes?: number | null
  host: string
  defaultView?: 'grid' | 'list'
  terminalsEnabled?: boolean
}

type UploadBatch = {
  files: File[]
  dir: string
  operation: ReturnType<typeof beginOperation>
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

export default function App({ account, onSignedOut }: { account: Account; onSignedOut: () => void }) {
  const quota = account.reservedBytes > 0 ? account.reservedBytes : 100 * 1024 ** 3
  const [items, setItems] = useState<DriveItem[]>([])
  const [usedBytes, setUsedBytes] = useState(account.usedBytes)
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
  const anchorId = useRef<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<SystemAlert[]>([])
  const dismissedAlerts = useRef(new Set<string>())
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'create-file' | 'rename'; id?: string }>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [shareLabel, setShareLabel] = useState('Shared')
  const [shareTarget, setShareTarget] = useState<DriveItem | null>(null)
  const [confirm, setConfirm] = useState<
    | null
    | { mode: 'permanent'; ids: string[]; name: string; size: number }
    | { mode: 'empty-trash' }
    | { mode: 'delete-forever'; ids: string[]; name: string }
  >(null)
  const [ttlHours, setTtlHours] = useState(24)
  const [customDays, setCustomDays] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadQueue = useRef<UploadBatch[]>([])
  const uploadWorker = useRef(false)
  const dragDepth = useRef(0)
  const [fileDragActive, setFileDragActive] = useState(false)
  const refreshing = useRef(false)
  const refreshPending = useRef(false)
  const refreshSequence = useRef(0)
  const currentView = useRef('')
  const viewKey = JSON.stringify([folderPath, profile.name, search, section])
  useLayoutEffect(() => { currentView.current = viewKey }, [viewKey])
  const lastStatus = useRef(0)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(t)
  }, [toast])

  const refreshAlerts = useCallback(async () => {
    try {
      const next = await fetchAlerts()
      setAlerts(next.filter((alert) => !dismissedAlerts.current.has(alert.id)))
    } catch {
      // Alerts should never interrupt file access.
    }
  }, [])

  useEffect(() => {
    const showBackblaze = () => {
      if (dismissedAlerts.current.has('backblaze-unavailable')) return
      setAlerts((current) => current.some((alert) => alert.id === 'backblaze-unavailable') ? current : [
        ...current,
        {
          id: 'backblaze-unavailable',
          tone: 'warning',
          message: 'Backblaze may have reached 100% of its bandwidth cap, which is restricting access to your files. Upgrade Backblaze or move your files to another node.',
        },
      ])
    }
    const refresh = () => { void refreshAlerts() }
    window.addEventListener('storebase:backblaze-unavailable', showBackblaze)
    window.addEventListener('storebase:files-changed', refresh)
    void refreshAlerts()
    const timer = window.setInterval(refresh, 5 * 60_000)
    return () => {
      window.removeEventListener('storebase:backblaze-unavailable', showBackblaze)
      window.removeEventListener('storebase:files-changed', refresh)
      window.clearInterval(timer)
    }
  }, [refreshAlerts])

  const crumbs = useMemo(() => {
    if (!folderPath) return []
    if (isTempId(folderPath)) {
      const rest = folderPath === '.temp' ? [] : folderPath.slice('.temp/'.length).split('/').filter(Boolean)
      return rest.map((name, i) => ({
        id: `.temp/${rest.slice(0, i + 1).join('/')}`,
        name,
      }))
    }
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

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (silent && refreshing.current) { refreshPending.current = true; return }
    refreshing.current = true
    const request = ++refreshSequence.current
    const requestedView = viewKey
    if (!silent) {
      setLoadError(null)
      setLoading(true)
    }
    try {
      const q = search.trim()
      let entries: FileEntry[]
      if (q) {
        entries = await listFiles({ view: 'search', q })
      } else if (section === 'trash') {
        entries = await listFiles({ view: 'trash' })
      } else if (section === 'starred') {
        entries = await listFiles({ view: 'starred' })
      } else if (section === 'recent') {
        entries = await listFiles({ view: 'recent' })
      } else if (section === 'home') {
        entries = await listFiles({ path: '' })
      } else if (section === 'shared') {
        const shared = parseSharePath(folderPath)
        if (shared) {
          entries = await listFiles({ view: 'shared', share: shared.shareId, path: shared.sub })
          if (entries[0]?.shareName) setShareLabel(entries[0].shareName)
        } else {
          entries = await listFiles({ view: 'shared' })
        }
      } else if (section === 'temp') {
        const sub = folderPath.replace(/^\.temp\/?/, '')
        entries = await listFiles({ view: 'temp', path: sub })
        const settings = await fetchTempSettings()
        setTtlHours(settings.ttlHours)
      } else if (section === 'spam') {
        entries = await listFiles({ view: 'spam' })
      } else {
        entries = await listFiles({ path: folderPath })
      }
      if (request !== refreshSequence.current || requestedView !== currentView.current) return
      const next = entries.map((entry) => toDriveItem(entry, { name: profile.name }))
      setItems((prev) => (itemsMatch(prev, next) ? prev : next))
      setLoading(false)
      if (Date.now() - lastStatus.current > 30000) {
        lastStatus.current = Date.now()
        void fetch('/api/status', { credentials: 'include' })
          .then(res => res.ok ? res.json() as Promise<{ usedBytes?: number }> : { usedBytes: undefined })
          .then(status => { if (typeof status.usedBytes === 'number') setUsedBytes(status.usedBytes) })
          .catch(() => { lastStatus.current = 0 })
      }
    } catch (err) {
      if (request === refreshSequence.current && requestedView === currentView.current && !silent) setLoadError(err instanceof Error ? err.message : 'Could not load files')
    } finally {
      if (request === refreshSequence.current) {
        refreshing.current = false
        setLoading(false)
        if (refreshPending.current) {
          refreshPending.current = false
          queueMicrotask(() => void refreshCurrent.current({ silent: true }))
        }
      }
    }
  }, [folderPath, profile.name, search, section, viewKey])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), search.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [refresh, search])

  useEffect(() => {
    let timer = 0
    const bump = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void refresh({ silent: true })
      }, 200)
    }
    const src = new EventSource('/api/drive/events', { withCredentials: true })
    window.addEventListener('storebase:files-changed', bump)
    src.addEventListener('drive', bump)
    src.addEventListener('hello', bump)
    src.addEventListener('message', bump)
    const poll = window.setInterval(() => {
      if (document.hidden) return
      bump()
    }, 30000)
    const onVis = () => {
      if (!document.hidden) bump()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      src.close()
      window.removeEventListener('storebase:files-changed', bump)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [refresh])

  const refreshCurrent = useRef(refresh)
  useLayoutEffect(() => { refreshCurrent.current = refresh }, [refresh])

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

  function select(id: string, mods: { toggle: boolean; range: boolean }) {
    setSelectedIds((current) => {
      if (mods.range && anchorId.current) {
        const a = orderedIds.indexOf(anchorId.current)
        const b = orderedIds.indexOf(id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          const range = orderedIds.slice(lo, hi + 1)
          if (mods.toggle) return [...new Set([...current, ...range])]
          return range
        }
      }
      if (!mods.range) anchorId.current = id
      if (mods.toggle) {
        return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
      }
      return current.length === 1 && current[0] === id ? current : [id]
    })
  }

  function openItem(item: DriveItem) {
    if (item.spam) {
      notify('Accept this share first')
      return
    }
    if (item.trashed) {
      notify('Restore this item to open it')
      return
    }
    if (item.kind === 'folder') {
      if (item.shareName) setShareLabel(item.shareName)
      setSection(isTempId(item.id) ? 'temp' : item.id.startsWith('share:') ? 'shared' : 'my-drive')
      setFolderPath(item.id)
      setSelectedIds([])
      setSearch('')
      return
    }
    setPreview(item)
  }

  async function star(ids: string[]) {
    const batch = ids.map((id) => items.find((entry) => entry.id === id)).filter((entry): entry is DriveItem => Boolean(entry))
    if (!batch.length) return
    const starred = !batch.every((entry) => entry.starred)
    try {
      await runBatch(batch, item => starFile(item.id, starred))
      notify(
        batch.length === 1
          ? starred
            ? `Starred ${batch[0].name}`
            : `Removed star from ${batch[0].name}`
          : starred
            ? `Starred ${batch.length} items`
            : `Removed star from ${batch.length} items`,
      )
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not star')
    }
  }

  async function trash(ids: string[], confirmed = false) {
    const batch = ids
      .map((id) => items.find((entry) => entry.id === id))
      .filter((entry): entry is DriveItem => entry != null && entry.owned !== false)
    if (!batch.length) return
    if (!confirmed && batch.some((item) => item.size != null && item.size > HARD_DELETE_BYTES)) {
      const huge = batch.find((item) => item.size != null && item.size > HARD_DELETE_BYTES)!
      setConfirm({
        mode: 'permanent',
        ids: batch.map((item) => item.id),
        name: batch.length === 1 ? huge.name : `${batch.length} items`,
        size: huge.size ?? 0,
      })
      return
    }
    try {
      let permanent = 0
      let trashed = 0
      await runBatch(batch, async item => {
        const result = await trashFile(item.id, confirmed)
        if (result.permanent) permanent += 1
        else trashed += 1
      })
      setSelectedIds([])
      notify(
        batch.length === 1
          ? permanent
            ? `Deleted ${batch[0].name} permanently`
            : `Moved ${batch[0].name} to trash`
          : `Moved ${trashed + permanent} items`,
      )
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PERMANENT_DELETE') {
        setConfirm({
          mode: 'permanent',
          ids: batch.map((item) => item.id),
          name: batch.length === 1 ? batch[0].name : `${batch.length} items`,
          size: err.size ?? batch[0].size ?? 0,
        })
        return
      }
      notify(err instanceof Error ? err.message : 'Could not trash')
    }
  }

  async function removeForever(ids: string[]) {
    const batch = ids.map((id) => items.find((entry) => entry.id === id)).filter((entry): entry is DriveItem => Boolean(entry))
    if (!batch.length) return
    try {
      await runBatch(batch, item => deleteFile(item.id))
      setSelectedIds([])
      notify(batch.length === 1 ? `Deleted ${batch[0].name}` : `Deleted ${batch.length} items`)
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  async function wipeTrash() {
    try {
      await emptyTrash()
      notify('Trash emptied')
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not empty trash')
    }
  }

  async function removeShare(id: string) {
    const parsed = parseSharePath(id)
    if (!parsed) return
    try {
      await deleteShare(parsed.shareId)
      notify(section === 'spam' ? 'Removed from Spam' : 'Removed from Shared with me')
      setFolderPath('')
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove')
    }
  }

  async function duplicate(ids: string[]) {
    const batch = ids
      .map((id) => items.find((entry) => entry.id === id))
      .filter((entry): entry is DriveItem => entry != null && entry.owned !== false && !entry.trashed && !entry.spam)
    if (!batch.length) return
    try {
      const copied = await copyFiles(batch.map((item) => item.id))
      notify(copied.length === 1 ? `Copied ${copied[0].name}` : `Copied ${copied.length} items`)
      setSelectedIds(copied.map((item) => item.path))
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not copy')
    }
  }

  async function acceptIncoming(id: string) {
    const parsed = parseSharePath(id)
    if (!parsed) return
    try {
      await acceptShare(parsed.shareId)
      notify('Accepted. It’s in Shared with me.')
      setSelectedIds([])
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not accept')
    }
  }

  async function restore(ids: string[]) {
    const batch = ids.map((id) => items.find((entry) => entry.id === id)).filter((entry): entry is DriveItem => Boolean(entry))
    if (!batch.length) return
    try {
      await runBatch(batch, item => restoreFile(item.id))
      notify(batch.length === 1 ? `Restored ${batch[0].name}` : `Restored ${batch.length} items`)
      setSelectedIds([])
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not restore')
    }
  }

  async function unzip(ids: string[]) {
    try {
      await runBatch(ids, unzipFile, 2)
      notify(ids.length === 1 ? 'Unzipped' : `Unzipped ${ids.length} items`)
      await refreshCurrent.current({ silent: true })
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
        const path = joinPath(section === 'temp' ? tempDir(folderPath) : section === 'my-drive' ? folderPath : '', name)
        await mkdir(path)
        notify(`Created ${name}`)
      }
      if (dialog?.mode === 'create-file') {
        const dir =
          section === 'temp'
            ? tempDir(folderPath)
            : section === 'my-drive' || section === 'home'
              ? section === 'my-drive'
                ? folderPath
                : ''
              : ''
        await uploadFile(dir, new File([''], name))
        notify(`Created ${name}`)
      }
      if (dialog?.mode === 'rename' && dialog.id) {
        await renameFile(dialog.id, name)
        notify(`Renamed to ${name}`)
      }
      setDialog(null)
      setNameDraft('')
      await refreshCurrent.current({ silent: true })
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
      app: 'Untitled.txt',
    }
    const dir = section === 'temp' ? tempDir(folderPath) : folderPath
    try {
      if (kind === 'folder') {
        await mkdir(joinPath(dir, names.folder))
      } else {
        await uploadFile(dir, new File([''], names[kind]))
      }
      if (section !== 'temp') setSection('my-drive')
      notify(`Created ${names[kind]}`)
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create')
    }
  }

  function onUpload(files: FileList | null, dest?: string) {
    if (!files?.length) return
    const dir = dest ?? (section === 'temp' ? tempDir(folderPath) : folderPath)
    const batch = Array.from(files)
    const operation = beginOperation('Upload queue', `${batch.length} file${batch.length === 1 ? '' : 's'} queued`)
    operation.progress(`${batch.length} file${batch.length === 1 ? '' : 's'} queued`, 0)
    uploadQueue.current.push({ files: batch, dir, operation })
    void drainUploads()
  }

  async function drainUploads() {
    if (uploadWorker.current) return
    uploadWorker.current = true
    try {
      while (uploadQueue.current.length) {
        const batch = uploadQueue.current.shift()!
        let firstError: unknown
        let uploaded = 0
        const uploadedNames: string[] = []
        for (const [index, file] of batch.files.entries()) {
          batch.operation.progress(`Uploading ${index + 1} of ${batch.files.length} · ${file.name}`, index / batch.files.length * 100)
          try {
            await uploadFile(batch.dir, file)
            uploaded += 1
            uploadedNames.push(file.name)
          } catch (error) {
            firstError ??= error
          }
        }
        if (firstError) batch.operation.finish(firstError)
        else batch.operation.finish()
        if (uploaded > 0) {
          setSection(isTempId(batch.dir) ? 'temp' : 'my-drive')
          setFolderPath(batch.dir)
          notify(uploaded === 1 ? `Uploaded ${uploadedNames[0]}` : `Uploaded ${uploaded} files`)
          await refreshCurrent.current({ silent: true })
        } else notify(firstError instanceof Error ? firstError.message : 'Upload failed')
      }
    } finally {
      uploadWorker.current = false
    }
  }

  async function sendToTemp(ids: string[]) {
    const valid = ids.filter((path) => !isTempId(path) && !path.startsWith('share:') && path !== '__node__')
    if (!valid.length) return
    try {
      const moved = await moveToTemp(valid)
      notify(moved.length === 1 ? `Moved ${moved[0].name} to Temp` : `Moved ${moved.length} items to Temp`)
      setSelectedIds([])
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not move to Temp')
    }
  }

  async function keepItem(ids: string[]) {
    const batch = ids.map((id) => items.find((entry) => entry.id === id)).filter((entry): entry is DriveItem => Boolean(entry))
    if (!batch.length) return
    try {
      await runBatch(batch, item => keepFromTemp(item.id))
      notify(batch.length === 1 ? `Kept ${batch[0].name} in My files` : `Kept ${batch.length} items in My files`)
      setSelectedIds([])
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not keep')
    }
  }

  async function applyTtl(hours: number) {
    try {
      const next = await setTempTtl(hours)
      setTtlHours(next.ttlHours)
      setCustomDays('')
      notify(`Temp files now delete after ${formatTtl(next.ttlHours)}`)
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not set timer')
    }
  }

  async function moveTo(paths: string[], dest: string) {
    const valid = paths.filter((id) => id !== dest && !dest.startsWith(`${id}/`) && !id.startsWith('share:') && id !== '__node__')
    if (!valid.length) return
    try {
      const moved = await moveFiles(valid, dest)
      if (!moved.length) return
      notify(moved.length === 1 ? `Moved ${moved[0].name}` : `Moved ${moved.length} items`)
      setSelectedIds([])
      await refreshCurrent.current({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not move')
    }
  }

  async function signOut() {
    await logout()
    onSignedOut()
  }

  const visible = items
  const orderedIds = useMemo(() => sortItems(visible, sort).map((item) => item.id), [sort, visible])
  const canMove =
    !search.trim() &&
    section !== 'trash' &&
    section !== 'shared' &&
    section !== 'spam' &&
    !folderPath.startsWith('share:')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(orderedIds)
        return
      }
      if (e.key === 'Escape') {
        setSelectedIds([])
        return
      }
      if (!selectedIds.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (section === 'trash') {
          const first = items.find((item) => item.id === selectedIds[0])
          if (!first) return
          setConfirm({
            mode: 'delete-forever',
            ids: selectedIds,
            name: selectedIds.length === 1 ? first.name : `${selectedIds.length} items`,
          })
          return
        }
        void trash(selectedIds)
        return
      }
      if (e.key === 'F2' && selectedIds.length === 1) {
        e.preventDefault()
        openRename(selectedIds[0])
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        void duplicate(selectedIds)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orderedIds, selectedIds, section, items])

  const heading = search.trim()
    ? `Results for "${search.trim()}"`
    : folderPath
      ? crumbs[crumbs.length - 1]?.name ?? titles[section]
      : titles[section]

  function dropDest(dest: string) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!canMove) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer.files.length) {
          void onUpload(e.dataTransfer.files, dest)
          return
        }
        try {
          const parsed = JSON.parse(e.dataTransfer.getData('text/plain')) as unknown
          if (Array.isArray(parsed)) {
            void moveTo(
              parsed.filter((id): id is string => typeof id === 'string'),
              dest,
            )
          }
        } catch {
          // not an internal move
        }
      },
    }
  }

  function hasDraggedFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function appDragEnter(event: DragEvent) {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setFileDragActive(true)
  }

  function appDragLeave(event: DragEvent) {
    if (!hasDraggedFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setFileDragActive(false)
  }

  function appDrop(event: DragEvent) {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    dragDepth.current = 0
    setFileDragActive(false)
    const dir = section === 'temp' ? tempDir(folderPath) : section === 'my-drive' ? folderPath : ''
    onUpload(event.dataTransfer.files, dir)
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[#1a1a1a] text-foreground"
      onDragEnter={appDragEnter}
      onDragOver={(event) => {
        if (!hasDraggedFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={appDragLeave}
      onDropCapture={() => {
        dragDepth.current = 0
        setFileDragActive(false)
      }}
      onDrop={appDrop}
    >
      {fileDragActive ? (
        <div className="pointer-events-none fixed inset-3 z-[70] flex items-center justify-center rounded-3xl border-2 border-dashed border-blue-300 bg-[#1a1a1a]/90 text-lg font-medium text-white shadow-2xl backdrop-blur-sm">
          Drop files to add them to the upload queue
        </div>
      ) : null}
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
      {alerts.map((alert) => (
        <AlertBanner
          key={alert.id}
          alert={alert}
          onClose={() => {
            dismissedAlerts.current.add(alert.id)
            setAlerts((current) => current.filter((item) => item.id !== alert.id))
          }}
        />
      ))}
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
                    onClick={() =>
                      goSection(section === 'shared' ? 'shared' : section === 'temp' ? 'temp' : 'my-drive')
                    }
                    {...(canMove ? dropDest(section === 'temp' ? '.temp' : '') : {})}
                  >
                    {section === 'shared' ? 'Shared with me' : section === 'temp' ? 'Temp' : 'My files'}
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
                        {...(canMove && i < crumbs.length - 1 ? dropDest(crumb.id) : {})}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                  {selectedIds.length > 1 ? (
                    <span className="ml-2 text-xs text-[#8d8d8d]">{selectedIds.length} selected</span>
                  ) : null}
                </>
              ) : (
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <h1 className="text-2xl font-normal tracking-tight text-foreground">{heading}</h1>
                    {selectedIds.length > 1 ? (
                      <span className="text-sm text-[#8d8d8d]">{selectedIds.length} selected</span>
                    ) : null}
                  </div>
                  {section === 'temp' ? (
                    <TempTtlBar
                      ttlHours={ttlHours}
                      customDays={customDays}
                      onCustomDays={setCustomDays}
                      onApply={applyTtl}
                    />
                  ) : null}
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

            {section === 'temp' && folderPath && !search.trim() ? (
              <TempTtlBar
                ttlHours={ttlHours}
                customDays={customDays}
                onCustomDays={setCustomDays}
                onApply={applyTtl}
              />
            ) : null}

            {loading && items.length === 0 ? (
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
                canCreate={
                  !search.trim() &&
                  (section === 'my-drive' || section === 'home' || section === 'temp') &&
                  !folderPath.startsWith('share:')
                }
                canMove={canMove}
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
                onStar={(ids) => void star(ids)}
                onShare={share}
                onRename={openRename}
                onTrash={(ids) => void trash(ids)}
                onRestore={(ids) => void restore(ids)}
                onDeleteForever={(ids) => {
                  const first = items.find((entry) => entry.id === ids[0])
                  if (!first) return
                  setConfirm({
                    mode: 'delete-forever',
                    ids,
                    name: ids.length === 1 ? first.name : `${ids.length} items`,
                  })
                }}
                onRemoveShare={(id) => void removeShare(id)}
                onDownload={(batch) => {
                  void (async () => {
                    for (const item of batch) {
                      await saveOriginal(item.id, item.name)
                    }
                  })()
                }}
                onUnzip={(ids) => void unzip(ids)}
                onMove={(paths, dest) => void moveTo(paths, dest)}
                onDropFiles={(files, dest) => void onUpload(files, dest)}
                onMoveToTemp={(ids) => void sendToTemp(ids)}
                onKeep={(ids) => void keepItem(ids)}
                onCopy={(ids) => void duplicate(ids)}
                onAcceptShare={(id) => void acceptIncoming(id)}
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
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'rename' ? 'Rename' : dialog?.mode === 'create-file' ? 'New file' : 'New folder'}
            </DialogTitle>
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
            <Button variant="ghost" className="rounded-full" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
              onClick={() => void submitDialog()}
              disabled={!nameDraft.trim()}
            >
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
          sourcePath={preview.id}
          editable={preview.owned !== false && !preview.trashed}
          filePath={
            preview.owned !== false && !preview.trashed && !preview.id.startsWith('share:') && !preview.spam
              ? preview.id
              : undefined
          }
          onRestored={async () => {
            notify(`Restored ${preview.name}`)
            await refreshCurrent.current({ silent: true })
          }}
          onSave={
            preview.owned !== false && !preview.trashed
              ? async (content) => {
                  await saveContent(preview.id, content)
                  notify(`Saved ${preview.name}`)
                  await refreshCurrent.current({ silent: true })
                }
              : undefined
          }
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
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {confirm?.mode === 'empty-trash'
                ? 'Empty trash?'
                : confirm?.mode === 'delete-forever'
                  ? 'Delete forever?'
                  : 'No trash for this file'}
            </DialogTitle>
            <DialogDescription className="text-[#8d8d8d]">
              {confirm?.mode === 'empty-trash'
                ? 'Everything in trash is deleted now.'
                : confirm?.mode === 'delete-forever'
                  ? `${confirm.name} leaves trash and is gone.`
                  : confirm?.mode === 'permanent'
                    ? `${confirm.name} is over 20 GB. Delete is permanent.`
                    : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full bg-[#c5221f] text-white hover:bg-[#a50e0e]"
              onClick={() => {
                const next = confirm
                setConfirm(null)
                if (next?.mode === 'empty-trash') void wipeTrash()
                if (next?.mode === 'delete-forever') void removeForever(next.ids)
                if (next?.mode === 'permanent') void trash(next.ids, true)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperationPanel />
      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#e3e3e3] px-4 py-2.5 text-sm font-medium text-[#1a1a1a] shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  )
}

function TempTtlBar({
  ttlHours,
  customDays,
  onCustomDays,
  onApply,
}: {
  ttlHours: number
  customDays: string
  onCustomDays: (value: string) => void
  onApply: (hours: number) => void
}) {
  const preset = TTL_PRESETS.some((item) => item.hours === ttlHours)
  return (
    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <span className="text-xs text-[#8d8d8d]">Delete after</span>
      {TTL_PRESETS.map((item) => (
        <button
          key={item.hours}
          type="button"
          onClick={() => void onApply(item.hours)}
          className={
            item.hours === ttlHours
              ? 'h-8 rounded-full bg-white px-3 text-xs font-medium text-[#1a1a1a]'
              : 'h-8 rounded-full bg-white/10 px-3 text-xs font-medium text-[#e8e8e8] hover:bg-white/15'
          }
        >
          {item.label}
        </button>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          const days = Number(customDays)
          if (!Number.isFinite(days) || days <= 0) return
          void onApply(Math.round(days * 24))
        }}
      >
        <Input
          type="number"
          min={1}
          max={365}
          inputMode="numeric"
          value={customDays}
          placeholder={preset ? 'Days' : String(ttlHours / 24)}
          className="h-8 w-16 rounded-full border-white/15 bg-[#242424] px-3 text-xs text-white placeholder:text-[#8d8d8d] focus-visible:ring-0"
          onChange={(e) => onCustomDays(e.target.value)}
        />
        <Button type="submit" variant="ghost" className="h-8 rounded-full px-3 text-xs text-white hover:bg-white/10">
          Set
        </Button>
      </form>
    </div>
  )
}
