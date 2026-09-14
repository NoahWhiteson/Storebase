import App from '@/App'
import { Login } from '@/components/Login'
import { Onboarding } from '@/components/Onboarding'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { fetchMe, type Me } from '@/lib/api'
import { fetchSetup, type SetupState } from '@/lib/setup'
import { useEffect, useState, type ReactNode } from 'react'

export function Gate() {
  const [phase, setPhase] = useState<'loading' | 'offline' | 'setup' | 'login' | 'ready'>('loading')
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [me, setMe] = useState<Me | null>(null)

  async function load() {
    setPhase('loading')
    try {
      const state = await fetchSetup()
      setSetup(state)
      if (!state.configured) {
        setPhase('setup')
        return
      }
      const session = await fetchMe()
      if (!session) {
        setPhase('login')
        return
      }
      setMe(session)
      setPhase('ready')
    } catch {
      setPhase('offline')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (phase === 'loading') {
    return (
      <Shell>
        <p className="text-sm text-[#8d8d8d]">Talking to this node…</p>
      </Shell>
    )
  }

  if (phase === 'offline') {
    return (
      <Shell>
        <h1 className="text-2xl font-medium">Node is offline</h1>
        <p className="mt-2 max-w-sm text-sm text-[#8d8d8d]">
          Start the Storebase server, then retry. Dev proxies /api to 127.0.0.1:4780.
        </p>
        <Button className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" onClick={() => void load()}>
          Retry
        </Button>
      </Shell>
    )
  }

  if (phase === 'setup' && setup && !setup.configured) {
    return (
      <Onboarding
        disk={setup.disk}
        onDone={async (account) => {
          setMe({
            user: { id: '', name: account.name, email: account.email, role: 'admin' },
            host: '',
            reservedBytes: account.reservedBytes,
            usedBytes: 0,
          })
          const session = await fetchMe()
          if (session) setMe(session)
          setPhase('ready')
        }}
      />
    )
  }

  if (phase === 'login') {
    return (
      <Login
        nodeName={setup && setup.configured ? setup.nodeName : undefined}
        signInMessage={setup && setup.configured ? setup.signInMessage : undefined}
        onDone={(session) => {
          setMe(session)
          setPhase('ready')
        }}
      />
    )
  }

  if (phase === 'ready' && me) {
    return (
      <App
        account={{
          id: me.user.id,
          name: me.user.name,
          email: me.user.email,
          role: me.user.role,
          reservedBytes: me.reservedBytes,
          usedBytes: me.usedBytes,
          host: me.host,
          defaultView: me.defaultView,
        }}
        onSignedOut={() => {
          setMe(null)
          setPhase('login')
        }}
      />
    )
  }

  return (
    <Shell>
      <p className="text-sm text-[#8d8d8d]">Something’s off. Retry setup.</p>
      <Button className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]" onClick={() => void load()}>
        Retry
      </Button>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#1a1a1a] px-6 text-white">
      <StorebaseLogo className="mb-6 size-12" />
      {children}
    </div>
  )
}
