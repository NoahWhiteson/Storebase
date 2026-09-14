import { Button } from '@/components/ui/button'
import { createTerminal, deleteTerminal, listTerminals, terminalSocket, type TerminalInfo } from '@/lib/terminals'
import { cn } from 'cn'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Plus, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

export function Terminals({
  onToast,
  onDisabled,
}: {
  onToast: (message: string) => void
  onDisabled?: () => void
}) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [max, setMax] = useState(4)
  const [idleMinutes, setIdleMinutes] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const data = await listTerminals()
      if (data.enabled === false) {
        onDisabled?.()
        return
      }
      setSessions(data.terminals)
      setMax(data.max)
      setIdleMinutes(data.idleMinutes)
      setError(null)
      setActiveId((current) => {
        if (current && data.terminals.some((item) => item.id === current)) return current
        return data.terminals[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load terminals')
    }
  }, [onDisabled])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 8000)
    return () => window.clearInterval(timer)
  }, [reload])

  async function create() {
    setBusy(true)
    try {
      const created = await createTerminal()
      await reload()
      setActiveId(created.id)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not create terminal')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      await deleteTerminal(id)
      await reload()
      onToast('Terminal closed')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#1a1a1a]">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setActiveId(session.id)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm',
                activeId === session.id ? 'bg-white/10 text-white' : 'text-[#b3b3b3] hover:bg-white/5 hover:text-white',
              )}
            >
              <SquareTerminal className="size-3.5" />
              {session.name}
              {!session.alive ? <span className="text-[#8d8d8d]">dead</span> : null}
              <span
                role="button"
                tabIndex={0}
                className="rounded-full p-0.5 hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation()
                  void remove(session.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    void remove(session.id)
                  }
                }}
              >
                <X className="size-3.5" />
              </span>
            </button>
          ))}
        </div>
        <Button
          className="h-9 shrink-0 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]"
          disabled={busy || sessions.filter((s) => s.alive).length >= max}
          onClick={() => void create()}
        >
          <Plus className="size-4" />
          New
        </Button>
      </div>
      <p className="shrink-0 px-5 pb-2 text-xs text-[#8d8d8d]">
        Shell on this machine. {max} live max
        {idleMinutes > 0 ? ` · idle kill after ${idleMinutes} min` : ' · no idle expiry'}.
      </p>
      {error ? <p className="px-5 pb-2 text-sm text-[#f28b82]">{error}</p> : null}
      {activeId ? (
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <TermPane key={activeId} id={activeId} onDead={() => void reload()} onToast={onToast} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <SquareTerminal className="mb-4 size-10 text-[#8d8d8d]" />
          <p className="text-lg font-medium text-white">No terminals</p>
          <p className="mt-2 max-w-sm text-sm text-[#8d8d8d]">
            New opens a real shell on this node. Type in it. It runs here, not in the browser.
          </p>
          <Button
            className="mt-6 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]"
            disabled={busy}
            onClick={() => void create()}
          >
            New terminal
          </Button>
        </div>
      )}
    </div>
  )
}

function TermPane({
  id,
  onDead,
  onToast,
}: {
  id: string
  onDead: () => void
  onToast: (message: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 4000,
      theme: {
        background: '#141414',
        foreground: '#e8e8e8',
        cursor: '#e8e8e8',
        selectionBackground: '#ffffff24',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    const ws = terminalSocket(id)
    const sendResize = () => {
      const dims = fit.proposeDimensions()
      if (!dims) return
      const cols = Math.max(20, dims.cols - 1)
      const rows = Math.max(8, dims.rows)
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    }
    requestAnimationFrame(sendResize)
    ws.onopen = () => sendResize()
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type?: string
          data?: string
          reason?: string
          code?: number
        }
        if (msg.type === 'out' && msg.data) term.write(msg.data)
        if (msg.type === 'exit') {
          term.write(`\r\n[process exited ${msg.code ?? 0}]\r\n`)
          onDead()
        }
        if (msg.type === 'gone') {
          term.write(`\r\n[terminal ${msg.reason ?? 'closed'}]\r\n`)
          onToast(msg.reason === 'idle' ? 'Terminal expired (idle)' : 'Terminal closed')
          onDead()
        }
      } catch {
        term.write(String(ev.data))
      }
    }
    ws.onerror = () => onToast('Terminal socket failed')
    const sub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'in', data }))
      }
    })
    const ro = new ResizeObserver(() => sendResize())
    ro.observe(el)
    return () => {
      sub.dispose()
      ro.disconnect()
      ws.close()
      term.dispose()
    }
  }, [id, onDead, onToast])

  return <div ref={hostRef} className="term-host absolute inset-0 overflow-hidden p-3" />
}
