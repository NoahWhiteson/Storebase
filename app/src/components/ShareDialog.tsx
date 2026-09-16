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
import { copyText } from '@/lib/clipboard'
import {
  createLink,
  createShare,
  deleteLink,
  deleteShare,
  listShares,
  publicLinkUrl,
  type LinkInfo,
  type ShareInfo,
} from '@/lib/api'
import { formatRemaining } from '@/lib/format'
import { useEffect, useRef, useState } from 'react'

const EXPIRY_OPTIONS = [
  { label: 'Never', hours: 0 },
  { label: '1 hour', hours: 1 },
  { label: '1 day', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
]

export function ShareDialog({
  path,
  name,
  onClose,
  onToast,
}: {
  path: string
  name: string
  onClose: () => void
  onToast: (message: string) => void
}) {
  const [shares, setShares] = useState<ShareInfo[]>([])
  const [link, setLink] = useState<LinkInfo | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expiresHours, setExpiresHours] = useState(0)
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)

  async function reload() {
    try {
      const payload = await listShares(path)
      setShares(payload.shares)
      setLink(payload.link)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load shares')
    }
  }

  useEffect(() => {
    void reload()
  }, [path])

  async function copyUrl(value: string) {
    urlRef.current?.focus()
    urlRef.current?.select()
    const ok = await copyText(value, urlRef.current)
    if (!ok) {
      setError('Copy failed. Select the link and copy it yourself.')
      return
    }
    onToast('Link copied')
  }

  async function shareWith(target: string) {
    const trimmed = target.trim()
    if (!trimmed.includes('@')) {
      setError('Email looks wrong')
      return
    }
    setBusy(true)
    try {
      setShares(await createShare(path, trimmed))
      setEmail('')
      setError(null)
      onToast(`Shared ${name} with ${trimmed}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share')
    } finally {
      setBusy(false)
    }
  }

  async function remove(share: ShareInfo) {
    setBusy(true)
    try {
      await deleteShare(share.id)
      setShares((current) => current.filter((item) => item.id !== share.id))
      onToast(`Stopped sharing with ${share.toName}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove')
    } finally {
      setBusy(false)
    }
  }

  function linkOpts(create: boolean) {
    const opts: { expiresHours?: number | null; password?: string | null } = {
      expiresHours: expiresHours > 0 ? expiresHours : 0,
    }
    if (clearPassword) opts.password = ''
    else if (password.trim()) opts.password = password.trim()
    else if (create) opts.password = undefined
    return opts
  }

  async function toggleLink(on: boolean) {
    setBusy(true)
    try {
      if (on) {
        const next = await createLink(path, linkOpts(true))
        setLink(next)
        setPassword('')
        setClearPassword(false)
        await copyUrl(publicLinkUrl(next.token))
        onToast('Link copied. Anyone with it can view, not the rest of the app.')
      } else if (link) {
        await deleteLink(link.id)
        setLink(null)
        setPassword('')
        setClearPassword(false)
        onToast('Link turned off')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update link')
    } finally {
      setBusy(false)
    }
  }

  async function applyLink() {
    setBusy(true)
    try {
      const next = await createLink(path, linkOpts(false))
      setLink(next)
      setPassword('')
      setClearPassword(false)
      onToast('Link updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update link')
    } finally {
      setBusy(false)
    }
  }

  const url = link ? publicLinkUrl(link.token) : ''

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-[#2a2a2a] bg-[#1a1a1a] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {name}</DialogTitle>
          <DialogDescription className="text-[#8d8d8d]">
            Send it by email to someone on this node, or copy a view-only link.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="text-sm text-[#f28b82]">{error}</p> : null}

        <div className="rounded-2xl bg-white/[0.04] px-4 py-3">
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(link)}
            disabled={busy}
            onClick={() => void toggleLink(!link)}
            className="flex w-full items-center justify-between gap-4 text-left"
          >
            <span className="text-sm text-[#e8e8e8]">Anyone with the link</span>
            <span className={link ? 'relative h-6 w-11 rounded-full bg-white' : 'relative h-6 w-11 rounded-full bg-white/20'}>
              <span
                className={
                  link
                    ? 'absolute top-0.5 left-5 size-5 rounded-full bg-[#1a1a1a]'
                    : 'absolute top-0.5 left-0.5 size-5 rounded-full bg-white'
                }
              />
            </span>
          </button>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-[#8d8d8d]">Expires</span>
              <select
                className="h-10 w-full rounded-xl border-0 bg-[#242424] px-3 text-sm text-white outline-none"
                value={expiresHours}
                onChange={(e) => setExpiresHours(Number(e.target.value))}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.hours} value={option.hours}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[#8d8d8d]">Password</span>
              <Input
                type="password"
                autoComplete="new-password"
                className="h-10 rounded-xl border-0 bg-[#242424] text-sm text-white"
                placeholder={link?.passwordProtected ? 'Keep current' : 'Optional'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (e.target.value) setClearPassword(false)
                }}
              />
            </label>
          </div>
          {link?.expiresAt ? (
            <p className="mt-2 text-xs text-[#8d8d8d]">{formatRemaining(link.expiresAt)}</p>
          ) : null}
          {link?.passwordProtected ? (
            <button
              type="button"
              className="mt-2 text-xs text-[#8d8d8d] underline-offset-2 hover:text-white hover:underline"
              onClick={() => {
                setClearPassword(true)
                setPassword('')
              }}
            >
              {clearPassword ? 'Password will be removed' : 'Remove password'}
            </button>
          ) : null}
          {link ? (
            <>
              <div className="mt-3 flex gap-2">
                <Input
                  ref={urlRef}
                  readOnly
                  className="h-10 rounded-xl border-0 bg-[#242424] text-xs text-white"
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  className="h-10 shrink-0 rounded-full bg-white px-3 text-[#1a1a1a] hover:bg-[#f2f2f2]"
                  onClick={() => void copyUrl(url)}
                >
                  Copy
                </Button>
              </div>
              <Button
                variant="ghost"
                className="mt-2 h-8 rounded-full px-3 text-xs"
                disabled={busy}
                onClick={() => void applyLink()}
              >
                Apply expiry / password
              </Button>
            </>
          ) : (
            <p className="mt-2 text-xs text-[#8d8d8d]">Off. They only see this file, not Storebase. Set expiry or a password before turning it on.</p>
          )}
        </div>

        {shares.length > 0 ? (
          <div className="space-y-2">
            {shares.map((share) => (
              <div key={share.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{share.toName}</div>
                  <div className="truncate text-xs text-[#8d8d8d]">
                    {share.toEmail}
                    {share.status === 'pending' ? ' · waiting to accept' : ''}
                  </div>
                </div>
                <Button variant="ghost" className="h-8 rounded-full text-[#f28b82]" disabled={busy} onClick={() => void remove(share)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#8d8d8d]">Nobody has email access yet.</p>
        )}

        <Input
          className="h-11 rounded-xl border-0 bg-[#242424] text-white placeholder:text-[#8d8d8d] outline-none focus-visible:ring-0"
          placeholder="email@on-this-node"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void shareWith(email)
          }}
        />
        <DialogFooter>
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            Done
          </Button>
          <Button
            className="rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
            disabled={busy || !email.trim()}
            onClick={() => void shareWith(email)}
          >
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
