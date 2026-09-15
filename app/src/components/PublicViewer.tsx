import { FileGlyph } from '@/components/FileGlyph'
import { FilePreview } from '@/components/FilePreview'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { VideoThumb } from '@/components/VideoThumb'
import { formatBytes } from '@/lib/format'
import { previewKind } from '@/lib/preview'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

type PublicMeta = {
  token: string
  name: string
  type: 'file' | 'folder'
  size: number
  modifiedAt: string
  ownerName: string
}

type PublicItem = {
  path: string
  name: string
  type: 'file' | 'folder'
  size: number
  modifiedAt: string
}

export function PublicViewer({ token }: { token: string }) {
  const [meta, setMeta] = useState<PublicMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [folderPath, setFolderPath] = useState('')
  const [items, setItems] = useState<PublicItem[]>([])
  const [preview, setPreview] = useState<PublicItem | null>(null)

  useEffect(() => {
    let gone = false
    void fetch(`/api/public/${token}`)
      .then(async (res) => {
        const body = (await res.json()) as PublicMeta & { error?: string }
        if (!res.ok) throw new Error(body.error ?? 'Link not found')
        if (!gone) setMeta(body)
      })
      .catch((err: unknown) => {
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
    void fetch(`/api/public/${token}/items${qs}`)
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

  function raw(path = '') {
    const qs = path ? `?path=${encodeURIComponent(path)}` : ''
    return `/api/public/${token}/raw${qs}`
  }
  function dl(path = '') {
    const qs = path ? `?path=${encodeURIComponent(path)}` : ''
    return `/api/public/${token}/download${qs}`
  }

  if (error) {
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
      <FilePreview
        name={preview.name}
        url={raw(preview.path)}
        downloadUrl={dl(preview.path)}
        onClose={() => setPreview(null)}
      />
    )
  }

  if (meta.type === 'file') {
    return (
      <FilePreview name={meta.name} url={raw()} downloadUrl={dl()} onClose={() => undefined} closable={false} />
    )
  }

  const crumbs = folderPath ? folderPath.split('/') : []

  return (
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
              <span className="text-xs text-[#8d8d8d]">{item.type === 'folder' ? '' : formatBytes(item.size)}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
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
  return <FileGlyph kind="doc" size="sm" />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#1a1a1a] px-6 text-white">
      <StorebaseLogo className="mb-6 size-12" />
      {children}
    </div>
  )
}
