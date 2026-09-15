import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { previewKind, renderMarkdown } from '@/lib/preview'
import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const TEXT_CAP = 1_500_000

export function FilePreview({
  name,
  url,
  downloadUrl,
  onClose,
  closable = true,
}: {
  name: string
  url: string
  downloadUrl: string
  onClose: () => void
  closable?: boolean
}) {
  const kind = previewKind(name)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && closable) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closable, onClose])

  useEffect(() => {
    if (kind !== 'text' && kind !== 'markdown') return
    let gone = false
    setText(null)
    setError(null)
    setTruncated(false)
    void fetch(url, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load file')
        const buf = await res.arrayBuffer()
        const slice = buf.byteLength > TEXT_CAP ? buf.slice(0, TEXT_CAP) : buf
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(slice)
        if (gone) return
        setTruncated(buf.byteLength > TEXT_CAP)
        setText(decoded)
      })
      .catch((err: unknown) => {
        if (!gone) setError(err instanceof Error ? err.message : 'Could not load file')
      })
    return () => {
      gone = true
    }
  }, [kind, url])

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
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{name}</div>
        <Button
          className="h-9 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]"
          onClick={() => window.open(downloadUrl, '_blank')}
        >
          <Download className="size-4" />
          Download
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8">
        {kind === 'image' ? (
          <img src={url} alt={name} className="mx-auto max-h-full max-w-full object-contain" />
        ) : null}
        {kind === 'video' ? (
          <video src={url} controls className="mx-auto max-h-full max-w-full" />
        ) : null}
        {kind === 'audio' ? (
          <div className="flex h-full items-center justify-center">
            <audio src={url} controls className="w-full max-w-xl" />
          </div>
        ) : null}
        {kind === 'pdf' ? (
          <iframe title={name} src={url} className="h-full min-h-[70vh] w-full rounded-lg bg-white" />
        ) : null}
        {kind === 'text' || kind === 'markdown' ? (
          error ? (
            <p className="text-sm text-[#f28b82]">{error}</p>
          ) : text == null ? (
            <p className="text-sm text-[#8d8d8d]">Loading…</p>
          ) : kind === 'markdown' ? (
            <div>
              {truncated ? <p className="mb-3 text-xs text-[#8d8d8d]">Showing the first 1.5 MB.</p> : null}
              <article
                className="md-body mx-auto max-w-3xl text-sm leading-6 text-[#e8e8e8]"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
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
              onClick={() => window.open(downloadUrl, '_blank')}
            >
              Download
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
