import type { Hono } from 'hono'
import { terminalsAllowed } from './platform.ts'
import { TerminalError, type TerminalHub } from './terminals.ts'
import type { UserRecord } from './users.ts'

type Vars = { user: UserRecord; root: string }

function fail(c: { json: (body: { error: string }, status: 400 | 403 | 404) => Response }, err: unknown) {
  if (err instanceof TerminalError) {
    const status = err.status === 403 ? 403 : err.status === 404 ? 404 : 400
    return c.json({ error: err.message }, status)
  }
  throw err
}

export function mountTerminals(app: Hono<{ Variables: Vars }>, hub: TerminalHub): void {
  app.get('/api/terminals', async (c) => {
    const user = c.get('user')
    const platform = await hub.settings()
    return c.json({
      enabled: terminalsAllowed(user, platform),
      terminals: platform.terminalEnabled ? hub.list(user.id) : [],
      max: platform.terminalMax,
      idleMinutes: platform.terminalIdleMinutes,
    })
  })

  app.post('/api/terminals', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }))
    try {
      const terminal = await hub.create(user, body.name)
      return c.json({ terminal }, 201)
    } catch (err) {
      return fail(c, err)
    }
  })

  app.get('/api/terminals/:id', (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const found = hub.list(user.id).find((item) => item.id === id)
    if (!found) return c.json({ error: 'Terminal not found' }, 404)
    return c.json({ terminal: found })
  })

  app.delete('/api/terminals/:id', (c) => {
    const user = c.get('user')
    try {
      hub.kill(c.req.param('id'), user.id)
      return c.json({ ok: true })
    } catch (err) {
      return fail(c, err)
    }
  })
}
