import { api } from '@/lib/api'

export type TerminalInfo = {
  id: string
  name: string
  ownerId: string
  ownerName: string
  createdAt: string
  lastActiveAt: string
  cols: number
  rows: number
  alive: boolean
  idleMs: number
}

export async function listTerminals(): Promise<{
  terminals: TerminalInfo[]
  max: number
  idleMinutes: number
}> {
  return api('/api/terminals')
}

export async function createTerminal(name?: string): Promise<TerminalInfo> {
  const res = await api<{ terminal: TerminalInfo }>('/api/terminals', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return res.terminal
}

export async function deleteTerminal(id: string): Promise<void> {
  await api(`/api/terminals/${id}`, { method: 'DELETE' })
}

export function terminalSocket(id: string): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return new WebSocket(`${proto}://${window.location.host}/api/terminals/${id}/stream`)
}
