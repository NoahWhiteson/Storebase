import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { VideoPlayer } from '@/components/VideoPlayer'
import { delimiterFor, parseCsv, serializeCsv } from '@/lib/csv'
import { listFileVersions, reportFileLoadFailure, restoreFileVersion, saveOriginalFromUrl, type FileVersion } from '@/lib/api'
import { formatBytes, formatDateTime } from '@/lib/format'
import { previewKind, renderMarkdown } from '@/lib/preview'
import { Download, Eye, History, Pencil, Plus, Save, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const TEXT_CAP = 1_500_000

export function FilePreview({
  name,
  url,
  downloadUrl,
  onClose,
  closable = true,
  editable = false,
  onSave,
  filePath,
  sourcePath,
  onRestored,
}: {
  name: string
  url: string
  downloadUrl: string
  onClose: () => void
  closable?: boolean
  editable?: boolean
  onSave?: (content: string) => Promise<void>
  filePath?: string
  sourcePath?: string
  onRestored?: () => Promise<void> | void
}) {
  const kind = previewKind(name)
  const canEdit = Boolean(editable && onSave && (kind === 'text' || kind === 'markdown' || kind === 'sheet'))
  const [text, setText] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'edit' | 'preview'>(canEdit ? 'edit' : 'preview')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<FileVersion[] | null>(null)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [bust, setBust] = useState(0)
  const src = bust ? `${url}${url.includes('?') ? '&' : '?'}v=${bust}` : url
  const dl = bust ? `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}v=${bust}` : downloadUrl
  const reportLoadError = () => {
    if (sourcePath) void reportFileLoadFailure(sourcePath)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (historyOpen) {
          setHistoryOpen(false)
          return
        }
        if (closable) onClose()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && canEdit && !truncated) {
        e.preventDefault()
        void persist()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (kind !== 'text' && kind !== 'markdown' && kind !== 'sheet') return
    let gone = false
    setText(null)
    setError(null)
    setTruncated(false)
    const controller = new AbortController()
    void fetch(src, { credentials: 'include', signal: controller.signal, headers: { Range: `bytes=0-${TEXT_CAP}` } })
      .then(async (res) => {
        if (res.status === 416 && res.headers.get('content-range') === 'bytes */0') {
          if (!gone) { setText(''); setDraft('') }
          return
        }
        if (!res.ok) throw new Error('Could not load file')
        // Bound reads even when a remote store ignores Range.
        const reader = res.body?.getReader()
        if (!reader) throw new Error('Empty file response')
        const bytes = new Uint8Array(TEXT_CAP + 1)
        let length = 0
        try {
          while (length < bytes.length) {
            const { value, done } = await reader.read()
            if (done) break
            const take = Math.min(value.length, bytes.length - length)
            bytes.set(value.subarray(0, take), length)
            length += take
          }
        } finally { await reader.cancel(); reader.releaseLock() }
        const buf = bytes.slice(0, length).buffer
        const slice = buf.byteLength > TEXT_CAP ? buf.slice(0, TEXT_CAP) : buf
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(slice)
        if (gone) return
        setTruncated(buf.byteLength > TEXT_CAP)
        setText(decoded)
        setDraft(decoded)
      })
      .catch((err: unknown) => {
        if (!gone) setError(err instanceof Error ? err.message : 'Could not load file')
        reportLoadError()
      })
    return () => {
      gone = true
      controller.abort()
    }
  }, [kind, src, sourcePath])

  useEffect(() => {
    if (!filePath || !historyOpen) return
    let gone = false
    setVersionError(null)
    void listFileVersions(filePath)
      .then((next) => {
        if (!gone) setVersions(next)
      })
      .catch((err: unknown) => {
        if (!gone) setVersionError(err instanceof Error ? err.message : 'Could not load versions')
      })
    return () => {
      gone = true
    }
  }, [filePath, historyOpen, bust])

  async function restore(id: string) {
    if (!filePath) return
    setRestoring(id)
    setVersionError(null)
    try {
      await restoreFileVersion(filePath, id)
      setBust(Date.now())
      setText(null)
      await onRestored?.()
      const next = await listFileVersions(filePath)
      setVersions(next)
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : 'Could not restore')
    } finally {
      setRestoring(null)
    }
  }

  const dirty = canEdit && !truncated && text != null && draft !== text

  async function persist(next = draft) {
    if (!onSave || truncated || text == null) return
    setSaving(true)
    setError(null)
    try {
      await onSave(next)
      setText(next)
      setDraft(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#141414] text-white">
      <header className="flex h-14 shrink-0 items-center gap-3 px-4">
        {closable ? (
          <Button variant="ghost" size="icon" className="size-9" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        ) : (
          <StorebaseLogo className="size-7" />
        )}
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {name}
          {dirty ? <span className="ml-2 text-xs text-[#8d8d8d]">unsaved</span> : null}
        </div>
        {filePath ? (
          <Button
            variant="ghost"
            className="h-9 rounded-full"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History className="size-4" />
            History
          </Button>
        ) : null}
        {canEdit && kind === 'markdown' && !truncated ? (
          <Button
            variant="ghost"
            className="h-9 rounded-full"
            onClick={() => setMode((current) => (current === 'edit' ? 'preview' : 'edit'))}
          >
            {mode === 'edit' ? <Eye className="size-4" /> : <Pencil className="size-4" />}
            {mode === 'edit' ? 'Preview' : 'Edit'}
          </Button>
        ) : null}
        {canEdit && !truncated ? (
          <Button
            className="h-9 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]"
            disabled={saving || !dirty}
            onClick={() => void persist()}
          >
            <Save className="size-4" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
        <Button
          className="h-9 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]"
          onClick={() => void saveOriginalFromUrl(dl, name)}
        >
          <Download className="size-4" />
          Download
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
      <div className={kind === 'video' ? 'relative flex min-h-0 flex-1 overflow-hidden bg-black' : 'min-h-0 flex-1 overflow-auto p-4 md:p-8'}>
        {kind === 'image' ? (
          <img
            src={src}
            alt={name}
            draggable={false}
            className="mx-auto max-h-full max-w-full object-contain"
            onError={reportLoadError}
            onContextMenu={(e) => {
              e.preventDefault()
              void saveOriginalFromUrl(dl, name)
            }}
          />
        ) : null}
        {kind === 'video' ? <VideoPlayer src={src} title={name} onLoadError={reportLoadError} /> : null}
        {kind === 'audio' ? (
          <div className="flex h-full items-center justify-center">
            <audio src={src} controls className="w-full max-w-xl" onError={reportLoadError} />
          </div>
        ) : null}
        {kind === 'pdf' ? (
          <iframe title={name} src={src} className="h-full min-h-[70vh] w-full rounded-lg bg-white" />
        ) : null}
        {kind === 'text' || kind === 'markdown' || kind === 'sheet' ? (
          error && text == null ? (
            <p className="text-sm text-[#f28b82]">{error}</p>
          ) : text == null ? (
            <p className="text-sm text-[#8d8d8d]">Loading…</p>
          ) : kind === 'sheet' ? (
            <div>
              {truncated ? <p className="mb-3 text-xs text-[#8d8d8d]">Showing the first 1.5 MB.</p> : null}
              {error ? <p className="mb-3 text-sm text-[#f28b82]">{error}</p> : null}
              <SheetEditor
                name={name}
                text={draft}
                readOnly={!canEdit || truncated}
                onChange={setDraft}
              />
            </div>
          ) : kind === 'markdown' && (mode === 'preview' || !canEdit || truncated) ? (
            <div>
              {truncated ? <p className="mb-3 text-xs text-[#8d8d8d]">Showing the first 1.5 MB.</p> : null}
              {error ? <p className="mb-3 text-sm text-[#f28b82]">{error}</p> : null}
              <article
                className="md-body mx-auto max-w-3xl text-sm leading-6 text-[#e8e8e8]"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
              />
            </div>
          ) : canEdit && !truncated ? (
            <div className="mx-auto flex h-full max-w-5xl flex-col">
              {error ? <p className="mb-3 text-sm text-[#f28b82]">{error}</p> : null}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={kind === 'markdown' || name.toLowerCase().endsWith('.txt')}
                className="min-h-[70vh] w-full flex-1 resize-none rounded-xl bg-[#1c1c1c] p-4 font-mono text-[13px] leading-5 text-[#e8e8e8] outline-none"
              />
            </div>
          ) : (
            <div>
              {truncated ? <p className="mb-3 text-xs text-[#8d8d8d]">Showing the first 1.5 MB.</p> : null}
              <pre className="mx-auto max-w-5xl overflow-x-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-[#e8e8e8]">
                {text}
              </pre>
            </div>
          )
        ) : null}
        {kind === 'none' ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-lg font-medium">No in-browser preview</p>
            <p className="mt-2 max-w-sm text-sm text-[#8d8d8d]">Download it and open it locally.</p>
            <Button
              className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
              onClick={() => void saveOriginalFromUrl(dl, name)}
            >
              Download
            </Button>
          </div>
        ) : null}
      </div>
      {historyOpen && filePath ? (
        <aside className="flex w-full max-w-sm shrink-0 flex-col border-l border-white/10 bg-[#1a1a1a] p-4">
          <div className="mb-3 text-sm font-medium">Versions</div>
          <p className="mb-4 text-xs text-[#8d8d8d]">
            Storebase keeps the last 8 overwrites under 80 MB. Restore puts the current file back on the stack first.
          </p>
          {versionError ? <p className="mb-3 text-sm text-[#f28b82]">{versionError}</p> : null}
          {versions == null ? (
            <p className="text-sm text-[#8d8d8d]">Loading history…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-[#8d8d8d]">No older versions yet. Save or re-upload this file to start a history.</p>
          ) : (
            <div className="flex flex-col gap-2 overflow-auto">
              {versions.map((version) => (
                <div key={version.id} className="rounded-xl bg-white/[0.04] px-3 py-2.5">
                  <div className="text-sm text-white">{formatDateTime(version.createdAt)}</div>
                  <div className="mt-0.5 text-xs text-[#8d8d8d]">{formatBytes(version.size)}</div>
                  <Button
                    variant="ghost"
                    className="mt-2 h-8 rounded-full px-3"
                    disabled={restoring != null}
                    onClick={() => void restore(version.id)}
                  >
                    <Undo2 className="size-4" />
                    {restoring === version.id ? 'Restoring…' : 'Restore'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </aside>
      ) : null}
      </div>
    </div>
  )
}

function SheetEditor({
  name,
  text,
  readOnly,
  onChange,
}: {
  name: string
  text: string
  readOnly: boolean
  onChange: (next: string) => void
}) {
  const delimiter = delimiterFor(name)
  const rows = useMemo(() => parseCsv(text, delimiter), [delimiter, text])

  function commit(next: string[][]) {
    onChange(serializeCsv(next, delimiter))
  }

  function setCell(r: number, c: number, value: string) {
    const next = rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : [...row]))
    commit(next)
  }

  function addRow() {
    const width = rows[0]?.length ?? 1
    commit([...rows, Array.from({ length: width }, () => '')])
  }

  function addCol() {
    commit(rows.map((row) => [...row, '']))
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="min-w-full border-collapse text-sm">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="sticky left-0 w-10 bg-[#1a1a1a] px-2 py-1 text-center text-xs text-[#8d8d8d]">{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} className="border border-white/10 p-0">
                    {readOnly ? (
                      <div className="min-w-[7rem] px-2 py-1.5 whitespace-pre-wrap">{cell}</div>
                    ) : (
                      <input
                        value={cell}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        className="min-w-[7rem] bg-transparent px-2 py-1.5 text-white outline-none"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {readOnly ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" className="h-9 rounded-full" onClick={addRow}>
            <Plus className="size-4" />
            Row
          </Button>
          <Button variant="ghost" className="h-9 rounded-full" onClick={addCol}>
            <Plus className="size-4" />
            Column
          </Button>
        </div>
      )}
    </div>
  )
}
