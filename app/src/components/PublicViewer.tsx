import { FileGlyph } from '@/components/FileGlyph'
import { FilePreview } from '@/components/FilePreview'
import { SafetyGauge } from '@/components/SafetyGauge'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { VideoThumb } from '@/components/VideoThumb'
import { formatBytes } from '@/lib/format'
import { previewKind } from '@/lib/preview'
import { saveOriginalFromUrl } from '@/lib/api'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

type PublicMeta = {
  token: string
  name: string
  type: 'file' | 'folder'
  size: number
  modifiedAt: string
  ownerName: string
  virusScan?: VirusScan | null
}

type VirusScan = { status: string; score: number | null; signature?: string }

type PublicItem = {
  path: string
  name: string
  type: 'file' | 'folder'
  size: number
  modifiedAt: string
  virusScan?: VirusScan | null
}

export function PublicViewer({ token }: { token: string }) {
  const [meta, setMeta] = useState<PublicMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [folderPath, setFolderPath] = useState('')
  const [items, setItems] = useState<PublicItem[]>([])
  const [preview, setPreview] = useState<PublicItem | null>(null)
  const [unsafeDownload, setUnsafeDownload] = useState<{ name: string; url: string } | null>(null)

  async function loadMeta() {
    const res = await fetch(`/api/public/${token}`, { credentials: 'include' })
    const body = (await res.json()) as PublicMeta & { error?: string; code?: string }
    if (res.status === 401 && body.code === 'PASSWORD') {
      setLocked(true)
      setMeta(null)
      setError(null)
      return
    }
    if (res.status === 401 && body.code === 'EXPIRED') {
      setLocked(false)
      setMeta(null)
      setError('This link has expired')
      return
    }
    if (!res.ok) throw new Error(body.error ?? 'Link not found')
    setLocked(false)
    setMeta(body)
    setError(null)
  }

  useEffect(() => {
    let gone = false
    void loadMeta().catch((err: unknown) => {
      if (!gone) setError(err instanceof Error ? err.message : 'Link not found')
    })
    return () => {
      gone = true
    }
  }, [token])

  useEffect(() => {
    if (!meta || meta.type !== 'folder') return
    let gone = false
    const qs = folderPath ? `?path=${encodeURIComponent(folderPath)}` : ''
    void fetch(`/api/public/${token}/items${qs}`, { credentials: 'include' })
      .then(async (res) => {
        const body = (await res.json()) as { items?: PublicItem[]; error?: string }
        if (!res.ok) throw new Error(body.error ?? 'Could not list folder')
        if (!gone) setItems(body.items ?? [])
      })
      .catch((err: unknown) => {
        if (!gone) setError(err instanceof Error ? err.message : 'Could not list folder')
      })
    return () => {
      gone = true
    }
  }, [folderPath, meta, token])

  async function unlock() {
    setUnlocking(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/${token}/unlock`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const body = (await res.json()) as { error?: string; code?: string }
      if (!res.ok) throw new Error(body.error ?? 'Wrong password')
      setPassword('')
      await loadMeta()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong password')
    } finally {
      setUnlocking(false)
    }
  }

  function raw(path = '') {
    const qs = path ? `?path=${encodeURIComponent(path)}` : ''
    return `/api/public/${token}/raw${qs}`
  }
  function dl(path = '') {
    const qs = path ? `?path=${encodeURIComponent(path)}` : ''
    return `/api/public/${token}/download${qs}`
  }

  function download(name: string, url: string, scan?: VirusScan | null) {
    if (scan?.score != null && scan.score < 50) {
      setUnsafeDownload({ name, url })
      return
    }
    void saveOriginalFromUrl(url, name)
  }

  const warning = (
    <Dialog open={unsafeDownload !== null} onOpenChange={(open) => !open && setUnsafeDownload(null)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Potentially unsafe file</DialogTitle>
          <DialogDescription className="text-[#8d8d8d]">This file is potentially a virus. Download it only if you trust where it came from.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" className="rounded-full" onClick={() => setUnsafeDownload(null)}>Cancel</Button>
          <Button
            variant="destructive"
            className="rounded-full bg-[#c5221f] text-white hover:bg-[#a50e0e]"
            onClick={() => {
              const target = unsafeDownload
              setUnsafeDownload(null)
              if (target) void saveOriginalFromUrl(target.url, target.name)
            }}
          >Download anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (locked) {
    return (
      <Shell>
        <h1 className="text-2xl font-medium">Password required</h1>
        <p className="mt-2 max-w-sm text-sm text-[#8d8d8d]">This link is locked. Enter the password the owner set.</p>
        {error ? <p className="mt-3 text-sm text-[#f28b82]">{error}</p> : null}
        <form
          className="mt-6 flex w-full max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void unlock()
          }}
        >
          <Input
            type="password"
            autoFocus
            className="h-11 rounded-xl border-0 bg-[#242424] text-white"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            className="h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
            disabled={unlocking || !password}
            type="submit"
          >
            {unlocking ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
      </Shell>
    )
  }

  if (error && !meta) {
    return (
      <Shell>
        <h1 className="text-2xl font-medium">This link doesn’t work</h1>
        <p className="mt-2 max-w-sm text-sm text-[#8d8d8d]">{error}</p>
      </Shell>
    )
  }

  if (!meta) {
    return (
      <Shell>
        <p className="text-sm text-[#8d8d8d]">Opening shared file…</p>
      </Shell>
    )
  }

  if (preview) {
    return (
      <>
      <FilePreview
        name={preview.name}
        url={raw(preview.path)}
        downloadUrl={dl(preview.path)}
        onClose={() => setPreview(null)}
        onDownload={() => download(preview.name, dl(preview.path), preview.virusScan)}
      />
      {warning}
      </>
    )
  }

  if (meta.type === 'file') {
    return (
      <>
        <FilePreview name={meta.name} url={raw()} downloadUrl={dl()} onClose={() => undefined} closable={false} onDownload={() => download(meta.name, dl(), meta.virusScan)} />
        {warning}
      </>
    )
  }

  const crumbs = folderPath ? folderPath.split('/') : []

  return (
    <>
    <div className="flex min-h-full flex-col bg-[#1a1a1a] text-white">
      <header className="flex h-14 items-center gap-3 px-4">
        <StorebaseLogo className="size-7" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{meta.name}</div>
          <div className="truncate text-xs text-[#8d8d8d]">Shared by {meta.ownerName}</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[#8d8d8d]">
          <button type="button" className="hover:text-white" onClick={() => setFolderPath('')}>
            {meta.name}
          </button>
          {crumbs.map((name, i) => (
            <span key={crumbs.slice(0, i + 1).join('/')} className="flex items-center gap-2">
              <ChevronRight className="size-4" />
              <button
                type="button"
                className={i === crumbs.length - 1 ? 'text-white' : 'hover:text-white'}
                onClick={() => setFolderPath(crumbs.slice(0, i + 1).join('/'))}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {items.map((item) => (
            <button
              key={item.path}
              type="button"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5"
              onClick={() => {
                const rel = relativeToShare(item.path, folderPath)
                if (item.type === 'folder') {
                  setFolderPath(rel)
                  return
                }
                setPreview({ ...item, path: rel })
              }}
            >
              <PublicMark token={token} item={item} folderPath={folderPath} />
              <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              {item.type === 'file' ? <SafetyGauge score={item.virusScan?.score} status={item.virusScan?.status} signature={item.virusScan?.signature} /> : null}
              <span className="text-xs text-[#8d8d8d]">{item.type === 'folder' ? '' : formatBytes(item.size)}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
    {warning}
    </>
  )
}

function relativeToShare(itemPath: string, folderPath: string): string {
  const name = itemPath.split('/').pop() ?? itemPath
  return folderPath ? `${folderPath}/${name}` : name
}

function PublicMark({
  token,
  item,
  folderPath,
}: {
  token: string
  item: PublicItem
  folderPath: string
}) {
  const rel = relativeToShare(item.path, folderPath)
  const kind = previewKind(item.name)
  const qs = rel ? `?path=${encodeURIComponent(rel)}` : ''
  if (item.type === 'folder') return <FileGlyph kind="folder" size="sm" />
  if (kind === 'video') {
    return <VideoThumb url={`/api/public/${token}/raw${qs}`} className="size-8 shrink-0 rounded-md" />
  }
  if (kind === 'image') return <FileGlyph kind="image" size="sm" />
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  const app = ['exe', 'msi', 'dll', 'lnk', 'scr', 'com', 'app', 'dmg', 'pkg', 'apk', 'aab', 'xapk', 'ipa', 'appimage', 'deb', 'rpm', 'iso', 'jar', 'war', 'bat', 'cmd', 'ps1'].includes(ext)
  return <FileGlyph kind={app ? 'app' : 'doc'} name={item.name} size="sm" />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#1a1a1a] px-6 text-white">
      <StorebaseLogo className="mb-6 size-12" />
      {children}
    </div>
  )
}
