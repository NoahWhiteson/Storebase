import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { login, type Me } from '@/lib/api'
import { useState, type KeyboardEvent } from 'react'

const fieldClass =
  'h-12 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'

export function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!email.includes('@')) return setError('Email looks wrong')
    if (!password) return setError('Password is required')
    setBusy(true)
    setError(null)
    try {
      const me = await login(email.trim(), password)
      onDone(me)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter' || busy) return
    e.preventDefault()
    void submit()
  }

  return (
    <div className="flex min-h-full flex-col bg-[#1a1a1a] text-white">
      <header className="flex h-16 items-center gap-2.5 px-5">
        <StorebaseLogo className="size-8" />
        <span className="text-[20px] font-medium tracking-tight">Storebase</span>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
        <h1 className="text-3xl font-medium tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-[#8d8d8d]">Use the account from this node’s onboarding.</p>
        <div className="mt-8 space-y-3">
          <Input
            autoFocus
            className={fieldClass}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onEnter}
            autoComplete="email"
            placeholder="Email"
          />
          <Input
            className={fieldClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onEnter}
            autoComplete="current-password"
            placeholder="Password"
          />
        </div>
        {error ? <p className="mt-4 text-sm text-[#f28b82]">{error}</p> : null}
        <Button
          type="button"
          className="mt-8 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Signing in…' : 'Continue'}
        </Button>
      </main>
    </div>
  )
}
