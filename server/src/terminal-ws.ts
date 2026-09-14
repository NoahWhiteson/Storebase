import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ServerType } from '@hono/node-server'
import type { ServerConfig } from './config.ts'
import { tokenFromCookieHeader, readSessionUserIdFromToken } from './session.ts'
import { TerminalError, type TerminalHub } from './terminals.ts'
import { findById, loadUsers } from './users.ts'

function pathId(url: string | undefined): string | null {
  if (!url) return null
  const { pathname } = new URL(url, 'http://storebase.local')
  const match = pathname.match(/^\/api\/terminals\/([^/]+)\/stream$/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function attachTerminalWs(server: ServerType, config: ServerConfig, hub: TerminalHub): void {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const id = pathId(req.url)
    if (!id) return
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleSocket(ws, req, id, config, hub)
    })
  })
}

async function handleSocket(
  ws: WebSocket,
  req: IncomingMessage,
  id: string,
  config: ServerConfig,
  hub: TerminalHub,
): Promise<void> {
  const userId = await readSessionUserIdFromToken(tokenFromCookieHeader(req.headers.cookie), config)
  if (!userId) {
    ws.close(4401, 'Sign in required')
    return
  }
  const users = await loadUsers(config)
  const user = findById(users, userId)
  if (!user) {
    ws.close(4401, 'Sign in required')
    return
  }
  let unsub: (() => void) | undefined
  try {
    unsub = hub.subscribe(id, user.id, (event) => {
      if (ws.readyState !== ws.OPEN) return
      ws.send(JSON.stringify(event))
    })
  } catch (err) {
    const status = err instanceof TerminalError ? err.status : 500
    ws.close(4000 + status, err instanceof Error ? err.message : 'Failed')
    return
  }
  ws.on('message', (raw) => {
    try {
      const text = typeof raw === 'string' ? raw : raw.toString()
      const msg = JSON.parse(text) as { type?: string; data?: string; cols?: number; rows?: number }
      if (msg.type === 'in' && typeof msg.data === 'string') {
        hub.write(id, user.id, msg.data)
        return
      }
      if (msg.type === 'resize' && msg.cols && msg.rows) {
        hub.resize(id, user.id, msg.cols, msg.rows)
      }
    } catch {
      // ignore a bad frame
    }
  })
  ws.on('close', () => unsub?.())
}
