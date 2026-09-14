import App from '@/App'
import { Onboarding } from '@/components/Onboarding'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { fetchSetup, type SetupState } from '@/lib/setup'
import { useEffect, useState, type ReactNode } from 'react'

type Account = {
  name: string
  email: string
  reservedBytes: number
}

export function Gate() {
  const [phase, setPhase] = useState<'loading' | 'offline' | 'setup' | 'ready'>('loading')
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [account, setAccount] = useState<Account | null>(null)

  async function load() {
    setPhase('loading')
    try {
      const state = await fetchSetup()
      setSetup(state)
      if (state.configured && state.admin) {
        setAccount({
          name: state.admin.name,
          email: state.admin.email,
          reservedBytes: state.reservedBytes,
        })
        setPhase('ready')
        return
      }
      setPhase('setup')
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
          Start the Storebase server, then retry. The app proxies /api to 127.0.0.1:4780.
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
        onDone={(next) => {
          setAccount(next)
          setPhase('ready')
        }}
      />
    )
  }

  if (phase === 'ready' && account) {
    return <App account={account} />
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
