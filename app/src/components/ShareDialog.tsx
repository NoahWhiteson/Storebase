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
import { createShare, deleteShare, listPeople, listShares, type Person, type ShareInfo } from '@/lib/api'
import { useEffect, useState } from 'react'

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
  const [people, setPeople] = useState<Person[]>([])
  const [shares, setShares] = useState<ShareInfo[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const [nextPeople, nextShares] = await Promise.all([listPeople(), listShares(path)])
      setPeople(nextPeople)
      setShares(nextShares)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load shares')
    }
  }

  useEffect(() => {
    void reload()
  }, [path])

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

  const taken = new Set(shares.map((share) => share.toUserId))
  const available = people.filter((person) => !taken.has(person.id))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-[#2a2a2a] bg-[#1a1a1a] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {name}</DialogTitle>
          <DialogDescription className="text-[#8d8d8d]">
            People on this node see it under Shared with me. No public link.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="text-sm text-[#f28b82]">{error}</p> : null}

        {shares.length > 0 ? (
          <div className="space-y-2">
            {shares.map((share) => (
              <div key={share.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{share.toName}</div>
                  <div className="truncate text-xs text-[#8d8d8d]">{share.toEmail}</div>
                </div>
                <Button variant="ghost" className="h-8 rounded-full text-[#f28b82]" disabled={busy} onClick={() => void remove(share)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#8d8d8d]">Nobody else has this yet.</p>
        )}

        {available.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#8d8d8d]">On this node</p>
            {available.map((person) => (
              <div key={person.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{person.name}</div>
                  <div className="truncate text-xs text-[#8d8d8d]">{person.email}</div>
                </div>
                <Button
                  className="h-8 rounded-full bg-white px-3 text-[#1a1a1a] hover:bg-[#f2f2f2]"
                  disabled={busy}
                  onClick={() => void shareWith(person.email)}
                >
                  Share
                </Button>
              </div>
            ))}
          </div>
        ) : people.length === 0 ? (
          <p className="text-sm text-[#8d8d8d]">Add another account in Settings if you want to share.</p>
        ) : null}

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
