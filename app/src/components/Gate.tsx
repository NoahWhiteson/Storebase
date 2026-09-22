import App from '@/App'
import { Login } from '@/components/Login'
import { Onboarding } from '@/components/Onboarding'
import { PublicViewer } from '@/components/PublicViewer'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { fetchMe, type Me } from '@/lib/api'
import { fetchSetup, type SetupState } from '@/lib/setup'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

const GATE_CACHE_KEY = 'storebase:gate:v1'

function loadGateCache(): { setup: SetupState; me: Me } | null {
  try {
    const raw = sessionStorage.getItem(GATE_CACHE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { setup?: SetupState; me?: Me }
    if (!value.setup || !value.me) return null
    return value as { setup: SetupState; me: Me }
  } catch {
    return null
  }
}

function storeGateCache(setup: SetupState, me: Me): void {
  try {
    sessionStorage.setItem(GATE_CACHE_KEY, JSON.stringify({ setup, me }))
  } catch {
    // Storage full or blocked; the cache is optional.
  }
}

function clearGateCache(): void {
  try {
    sessionStorage.removeItem(GATE_CACHE_KEY)
  } catch {
    // ignore
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Timed out')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function Gate() {
  const token = window.location.pathname.match(/^\/s\/([^/]+)/)?.[1]
  if (token) return <PublicViewer token={decodeURIComponent(token)} />
  return <AppGate />
}

function AppGate() {
  const [phase, setPhase] = useState<'loading' | 'offline' | 'setup' | 'login' | 'ready'>('loading')
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [stalled, setStalled] = useState(false)

  const revalidate = useCallback(async () => {
    try {
      const [nextSetup, session] = await Promise.all([
        withTimeout(fetchSetup(), 30000),
        withTimeout(fetchMe(), 30000),
      ])
      setSetup(nextSetup)
      if (!nextSetup.configured) {
        clearGateCache()
        setPhase('setup')
        return
      }
      if (!session) {
        clearGateCache()
        setPhase('login')
        return
      }
      setMe(session)
      setPhase('ready')
      storeGateCache(nextSetup, session)
    } catch {
      // Network stalled behind the cache; keep the cached session usable.
    }
  }, [])

  async function load() {
    setPhase('loading')
    setStalled(false)
    const slow = window.setTimeout(() => setStalled(true), 6000)
    try {
      const cached = loadGateCache()
      if (cached) {
        setSetup(cached.setup)
        setMe(cached.me)
        setPhase('ready')
        void revalidate()
        window.clearTimeout(slow)
        return
      }
      const state = await withTimeout(fetchSetup(), 50000)
      setSetup(state)
      if (!state.configured) {
        setPhase('setup')
        return
      }
      const session = await withTimeout(fetchMe(), 50000)
      if (!session) {
        setPhase('login')
        return
      }
      setMe(session)
      setPhase('ready')
      storeGateCache(state, session)
    } catch {
      setPhase('offline')
    } finally {
      window.clearTimeout(slow)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (phase === 'loading') {
    return (
      <Shell>
        <p className="text-sm text-[#8d8d8d]">
          {stalled
            ? 'Still talking to this node… this server is taking longer than usual to respond.'
            : 'Talking to this node…'}
        </p>
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
              terminalsEnabled: true,
            })
            const session = await fetchMe()
            if (session) {
              setMe(session)
              storeGateCache(setup as SetupState, session)
            }
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
          if (setup) storeGateCache(setup, session)
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
          terminalsEnabled: me.terminalsEnabled !== false,
          virusScanEnabled: me.virusScanEnabled,
          operationNotifications: me.user.operationNotifications !== false,
        }}
        onSignedOut={() => {
          clearGateCache()
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
