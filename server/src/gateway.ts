import { execSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getRequestListener } from '@hono/node-server'
import { Client, crypto, directory } from 'acme-client'
import type { ServerConfig } from './config.ts'
import {
  acmeEmail,
  certPaths,
  clearDomainFiles,
  detectPublicIps,
  dnsPointsHere,
  loadDomain,
  lookupHostname,
  parseHostname,
  saveDomain,
  type DomainState,
  type HttpMode,
  type Port80Owner,
} from './domain.ts'

type AppHandle = {
  fetch: (request: Request) => Response | Promise<Response>
  attach: (server: HttpServer | HttpsServer) => void
}

export type GatewayListen = {
  httpBound: boolean
  httpsBound: boolean
  httpMode: HttpMode
  port80Owner: Port80Owner
}

const challenges = new Map<string, string>()

let gateway: DomainGateway | null = null

export function getDomainGateway(): DomainGateway | null {
  return gateway
}

export function acmeKeyAuthorization(token: string): string | undefined {
  return challenges.get(token)
}

export function startDomainGateway(config: ServerConfig, app: AppHandle): DomainGateway {
  gateway = new DomainGateway(config, app)
  void gateway.boot()
  return gateway
}

export class DomainGateway {
  private http: HttpServer | null = null
  private https: HttpsServer | null = null
  private busy = false
  private proxyMode = false
  private occupier: Port80Owner = null
  private config: ServerConfig
  private app: AppHandle

  constructor(config: ServerConfig, app: AppHandle) {
    this.config = config
    this.app = app
  }

  get httpBound(): boolean {
    return Boolean(this.http?.listening)
  }

  get httpsBound(): boolean {
    return Boolean(this.https?.listening)
  }

  listenExtra(): GatewayListen {
    return {
      httpBound: this.httpBound,
      httpsBound: this.httpsBound,
      httpMode: this.proxyMode ? 'proxy' : 'direct',
      port80Owner: this.occupier,
    }
  }

  async boot(): Promise<void> {
    const state = await loadDomain(this.config)
    if (state.hostname) {
      await this.ensureHttp()
      if (state.status === 'active') await this.ensureHttps()
    }
    setInterval(() => {
      void this.tick()
    }, 12_000)
    void this.tick()
  }

  async setHostname(raw: string): Promise<DomainState> {
    const hostname = parseHostname(raw)
    if (!hostname) throw new DomainError('Enter a hostname you own, like drive.example.com')
    const ips = await detectPublicIps()
    const next: DomainState = {
      hostname,
      status: 'waiting-dns',
      error: null,
      publicIpv4: ips.ipv4,
      publicIpv6: ips.ipv6,
      issuedAt: null,
      expiresAt: null,
    }
    await saveDomain(this.config, next)
    await this.ensureHttp()
    void this.tick()
    return next
  }

  async clear(): Promise<void> {
    this.stopHttps()
    await clearDomainFiles(this.config)
  }

  async refresh(): Promise<DomainState> {
    const ips = await detectPublicIps()
    const current = await loadDomain(this.config)
    if (!current.hostname) {
      const idle: DomainState = { ...current, publicIpv4: ips.ipv4, publicIpv6: ips.ipv6 }
      await saveDomain(this.config, idle)
      return idle
    }
    await saveDomain(this.config, {
      ...current,
      publicIpv4: ips.ipv4,
      publicIpv6: ips.ipv6,
      error: current.status === 'error' ? null : current.error,
      status: current.status === 'error' || current.status === 'idle' ? 'waiting-dns' : current.status,
    })
    await this.tick()
    return loadDomain(this.config)
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    const state = await loadDomain(this.config)
    if (!state.hostname) return
    this.busy = true
    try {
      const ips = await detectPublicIps()
      const merged: DomainState = {
        ...state,
        publicIpv4: ips.ipv4 ?? state.publicIpv4,
        publicIpv6: ips.ipv6 ?? state.publicIpv6,
      }
      await this.ensureHttp()
      if (merged.status === 'active') {
        if (this.caddyFronted()) {
          await this.pollCaddyHttps(merged)
          return
        }
        if (needsRenew(merged.expiresAt)) {
          if (!this.canIssue()) return
          await this.issue(merged)
        } else {
          await this.ensureHttps()
          await saveDomain(this.config, merged)
        }
        return
      }
      const hostname = merged.hostname
      if (!hostname) return
      const resolved = await lookupHostname(hostname)
      if (!dnsPointsHere(merged, resolved)) {
        await saveDomain(this.config, {
          ...merged,
          status: 'waiting-dns',
          error: missingDnsMessage(merged, resolved),
        })
        return
      }
      if (this.caddyFronted()) {
        await saveDomain(this.config, { ...merged, status: 'issuing', error: null })
        await this.pollCaddyHttps(merged)
        return
      }
      if (!this.canIssue()) {
        if (!this.proxyMode) {
          await saveDomain(this.config, {
            ...merged,
            status: 'error',
            error: bindError(80),
          })
        }
        return
      }
      await this.issue(merged)
    } catch (err) {
      const current = await loadDomain(this.config)
      await saveDomain(this.config, {
        ...current,
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not issue a certificate',
      })
    } finally {
      this.busy = false
    }
  }

  private canIssue(): boolean {
    return this.httpBound || this.proxyMode
  }

  private caddyFronted(): boolean {
    return this.proxyMode && this.occupier === 'caddy'
  }

  private async pollCaddyHttps(state: DomainState): Promise<void> {
    if (!state.hostname) return
    try {
      const res = await fetch(`https://${state.hostname}/api/health`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      await saveDomain(this.config, { ...state, status: 'active', error: null })
    } catch {
      if (state.status !== 'active') {
        await saveDomain(this.config, { ...state, status: 'issuing', error: null })
      }
    }
  }

  private async issue(state: DomainState): Promise<void> {
    if (!state.hostname) return
    await saveDomain(this.config, { ...state, status: 'issuing', error: null })
    const paths = certPaths(this.config)
    await mkdir(this.config.certsDir, { recursive: true })
    const accountKey = await loadOrCreateAccountKey(paths.accountKey)
    const client = new Client({
      directoryUrl: directory.letsencrypt.production,
      accountKey,
    })
    const [key, csr] = await crypto.createCsr({
      commonName: state.hostname,
      altNames: [state.hostname],
    })
    const cert = await client.auto({
      csr,
      email: await acmeEmail(this.config, state.hostname),
      termsOfServiceAgreed: true,
      challengePriority: ['http-01'],
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'http-01') return
        challenges.set(challenge.token, keyAuthorization)
      },
      challengeRemoveFn: async (_authz, challenge, _keyAuthorization) => {
        challenges.delete(challenge.token)
      },
    })
    await writeFile(paths.key, key)
    await writeFile(paths.cert, cert)
    await saveDomain(this.config, {
      ...state,
      status: 'active',
      error: null,
      issuedAt: new Date().toISOString(),
      expiresAt: certExpiry(String(cert)),
    })
    await this.ensureHttps()
  }

  private async ensureHttp(): Promise<void> {
    if (this.http?.listening || this.proxyMode) return
    this.occupier = this.occupier ?? detectPort80Owner()
    const server = createHttpServer((req, res) => {
      const token = acmeToken(req.url)
      if (token) {
        const body = challenges.get(token)
        if (body) {
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end(body)
          return
        }
        res.writeHead(404)
        res.end()
        return
      }
      void loadDomain(this.config).then((state) => {
        if (state.hostname && state.status === 'active') {
          res.writeHead(301, { location: `https://${state.hostname}${req.url ?? '/'}` })
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(
          state.hostname
            ? `Storebase is waiting for DNS / SSL on ${state.hostname}.`
            : 'Storebase HTTP gateway. Set a domain in Settings.',
        )
      })
    })
    try {
      await listen(server, 80)
      this.http = server
      this.proxyMode = false
    } catch (err) {
      server.close()
      if (errorCode(err) === 'EADDRINUSE') {
        this.proxyMode = true
        this.occupier = detectPort80Owner() ?? 'unknown'
        return
      }
      const current = await loadDomain(this.config)
      if (current.hostname) {
        await saveDomain(this.config, {
          ...current,
          status: current.status === 'active' ? current.status : 'error',
          error: bindError(80, err),
        })
      }
    }
  }

  private async ensureHttps(): Promise<void> {
    if (this.proxyMode) return
    const paths = certPaths(this.config)
    let key: string
    let cert: string
    try {
      key = await readFile(paths.key, 'utf8')
      cert = await readFile(paths.cert, 'utf8')
    } catch {
      return
    }
    if (this.https?.listening) {
      this.https.setSecureContext({ key, cert })
      return
    }
    const server = createHttpsServer({ key, cert }, getRequestListener(this.app.fetch))
    try {
      await listen(server, 443)
      this.app.attach(server)
      this.https = server
    } catch (err) {
      server.close()
      if (errorCode(err) === 'EADDRINUSE') {
        this.proxyMode = true
        this.occupier = this.occupier ?? detectPort80Owner() ?? 'unknown'
        return
      }
      const current = await loadDomain(this.config)
      await saveDomain(this.config, {
        ...current,
        status: 'error',
        error: bindError(443, err),
      })
    }
  }

  private stopHttps(): void {
    this.https?.close()
    this.https = null
  }
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

export function detectPort80Owner(): Port80Owner {
  const blobs: string[] = []
  for (const cmd of ['ss -tlnp', 'lsof -nP -iTCP:80 -sTCP:LISTEN']) {
    try {
      blobs.push(execSync(cmd, { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }))
    } catch {
      // binary missing or no permission for process names
    }
  }
  const text = blobs.join('\n').toLowerCase()
  if (!/:80\b/.test(text)) return null
  if (text.includes('nginx')) return 'nginx'
  if (text.includes('caddy')) return 'caddy'
  if (text.includes('apache') || text.includes('httpd')) return 'apache'
  return 'unknown'
}

function acmeToken(url: string | undefined): string | null {
  if (!url) return null
  const match = url.split('?')[0]?.match(/^\/\.well-known\/acme-challenge\/([^/]+)$/)
  return match?.[1] ?? null
}

async function loadOrCreateAccountKey(path: string): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch {
    const key = await crypto.createPrivateKey()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, key)
    return Buffer.isBuffer(key) ? key : Buffer.from(key)
  }
}

function listen(server: HttpServer | HttpsServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListen)
      reject(err)
    }
    const onListen = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListen)
    server.listen(port, '0.0.0.0')
  })
}

function errorCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : ''
}

function bindError(port: number, err?: unknown): string {
  const code = errorCode(err)
  if (code === 'EACCES') {
    return `Need permission to bind port ${port}. Run the node as root, or: sudo setcap cap_net_bind_service=+ep ${process.execPath}`
  }
  if (code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Keep your reverse proxy and point it at this node.`
  }
  return err instanceof Error ? err.message : `Could not listen on port ${port}`
}

function missingDnsMessage(state: DomainState, resolved: { ipv4: string[]; ipv6: string[] }): string | null {
  if (resolved.ipv4.length === 0 && resolved.ipv6.length === 0) {
    return `No DNS yet for ${state.hostname}. Add the A record below and wait for it to propagate.`
  }
  const seen = [...resolved.ipv4, ...resolved.ipv6].join(', ')
  return `${state.hostname} resolves to ${seen}, not this node. Point it at ${state.publicIpv4 ?? state.publicIpv6 ?? 'this server'}.`
}

function needsRenew(expiresAt: string | null): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000
}

function certExpiry(pem: string): string | null {
  const match = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)
  if (!match) return null
  try {
    return new Date(new X509Certificate(match[0]).validTo).toISOString()
  } catch {
    return null
  }
}
