import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { networkInterfaces } from 'node:os'
import { resolve4, resolve6 } from 'node:dns/promises'
import type { ServerConfig } from './config.ts'
import { loadUsers } from './users.ts'

export type DomainStatus = 'idle' | 'waiting-dns' | 'issuing' | 'active' | 'error'

export type DnsRecord = {
  type: 'A' | 'AAAA'
  host: string
  value: string
  ttl: number
}

export type DomainState = {
  hostname: string | null
  status: DomainStatus
  error: string | null
  publicIpv4: string | null
  publicIpv6: string | null
  issuedAt: string | null
  expiresAt: string | null
}

export type HttpMode = 'direct' | 'proxy'

export type Port80Owner = 'nginx' | 'caddy' | 'apache' | 'unknown' | null

export type ProxyConfigs = {
  nginx: string
  caddy: string
  apache: string
}

export type DomainPublic = DomainState & {
  records: DnsRecord[]
  httpsUrl: string | null
  httpBound: boolean
  httpsBound: boolean
  httpMode: HttpMode
  port80Owner: Port80Owner
  configs: ProxyConfigs
}

const EMPTY: DomainState = {
  hostname: null,
  status: 'idle',
  error: null,
  publicIpv4: null,
  publicIpv6: null,
  issuedAt: null,
  expiresAt: null,
}

export function parseHostname(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, '')
  const withoutScheme = trimmed.replace(/^https?:\/\//, '').split('/')[0] ?? ''
  const host = withoutScheme.split(':')[0] ?? ''
  if (!host || host === 'localhost') return null
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null
  return host
}

export async function loadDomain(config: ServerConfig): Promise<DomainState> {
  try {
    const parsed = JSON.parse(await readFile(config.domainPath, 'utf8')) as Partial<DomainState>
    return {
      hostname: parsed.hostname ? parseHostname(parsed.hostname) : null,
      status: validStatus(parsed.status) ? parsed.status : parsed.hostname ? 'waiting-dns' : 'idle',
      error: parsed.error ?? null,
      publicIpv4: parsed.publicIpv4 ?? null,
      publicIpv6: parsed.publicIpv6 ?? null,
      issuedAt: parsed.issuedAt ?? null,
      expiresAt: parsed.expiresAt ?? null,
    }
  } catch {
    return { ...EMPTY }
  }
}

export async function saveDomain(config: ServerConfig, state: DomainState): Promise<void> {
  await mkdir(dirname(config.domainPath), { recursive: true })
  await writeFile(config.domainPath, `${JSON.stringify(state, null, 2)}\n`)
}

export async function clearDomainFiles(config: ServerConfig): Promise<void> {
  await saveDomain(config, { ...EMPTY })
  await rm(config.certsDir, { recursive: true, force: true })
}

function validStatus(value: unknown): value is DomainStatus {
  return value === 'idle' || value === 'waiting-dns' || value === 'issuing' || value === 'active' || value === 'error'
}

let ipCache: { at: number; ipv4: string | null; ipv6: string | null } | null = null

export async function detectPublicIps(): Promise<{ ipv4: string | null; ipv6: string | null }> {
  if (ipCache && Date.now() - ipCache.at < 5 * 60_000) {
    return { ipv4: ipCache.ipv4, ipv6: ipCache.ipv6 }
  }
  const [ipv4, ipv6] = await Promise.all([
    fetchText('https://api.ipify.org'),
    fetchText('https://api6.ipify.org'),
  ])
  const resolved = {
    ipv4: isV4(ipv4) ? ipv4 : firstLocalV4(),
    ipv6: isV6(ipv6) ? ipv6 : null,
  }
  ipCache = { at: Date.now(), ...resolved }
  return resolved
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const text = (await res.text()).trim()
    return text || null
  } catch {
    return null
  }
}

function isV4(value: string | null): value is string {
  return Boolean(value && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))
}

function isV6(value: string | null): value is string {
  return Boolean(value && value.includes(':') && !value.includes('.'))
}

function firstLocalV4(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const row of addrs ?? []) {
      if (row.family === 'IPv4' && !row.internal) return row.address
    }
  }
  return null
}

export function dnsRecords(state: DomainState): DnsRecord[] {
  if (!state.hostname) return []
  const records: DnsRecord[] = []
  if (state.publicIpv4) {
    records.push({ type: 'A', host: state.hostname, value: state.publicIpv4, ttl: 300 })
  }
  if (state.publicIpv6) {
    records.push({ type: 'AAAA', host: state.hostname, value: state.publicIpv6, ttl: 300 })
  }
  return records
}

export async function lookupHostname(hostname: string): Promise<{ ipv4: string[]; ipv6: string[] }> {
  const ipv4 = await resolve4(hostname).catch(() => [] as string[])
  const ipv6 = await resolve6(hostname).catch(() => [] as string[])
  return { ipv4, ipv6 }
}

export function dnsPointsHere(state: DomainState, resolved: { ipv4: string[]; ipv6: string[] }): boolean {
  if (state.publicIpv4 && resolved.ipv4.includes(state.publicIpv4)) return true
  if (state.publicIpv6 && resolved.ipv6.includes(state.publicIpv6)) return true
  return false
}

export async function publicDomain(
  config: ServerConfig,
  extra?: {
    httpBound?: boolean
    httpsBound?: boolean
    httpMode?: HttpMode
    port80Owner?: Port80Owner
  },
): Promise<DomainPublic> {
  const state = await loadDomain(config)
  return {
    ...state,
    records: dnsRecords(state),
    httpsUrl: state.hostname && state.status === 'active' ? `https://${state.hostname}` : null,
    httpBound: extra?.httpBound ?? false,
    httpsBound: extra?.httpsBound ?? false,
    httpMode: extra?.httpMode ?? 'direct',
    port80Owner: extra?.port80Owner ?? null,
    configs: state.hostname ? proxyConfigs(config, state.hostname) : { nginx: '', caddy: '', apache: '' },
  }
}

export function proxyConfigs(config: ServerConfig, hostname: string): ProxyConfigs {
  const upstream = `127.0.0.1:${config.port}`
  const cert = `${config.certsDir}/fullchain.pem`
  const key = `${config.certsDir}/privkey.pem`
  const proxyHeaders = `        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;`
  return {
    nginx: `# /etc/nginx/sites-available/storebase  then: ln -s .../storebase sites-enabled && nginx -t && nginx -s reload
server {
    listen 80;
    listen [::]:80;
    server_name ${hostname};

    location /.well-known/acme-challenge/ {
        proxy_pass http://${upstream};
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${hostname};

    ssl_certificate ${cert};
    ssl_certificate_key ${key};

    client_max_body_size 0;

    location / {
        proxy_pass http://${upstream};
${proxyHeaders}
    }
}`,
    caddy: `${hostname} {
    reverse_proxy ${upstream}
}`,
    apache: `# Storebase behind Apache. Enable: a2enmod proxy proxy_http ssl headers rewrite
<VirtualHost *:80>
    ServerName ${hostname}
    ProxyPreserveHost On
    ProxyPass /.well-known/acme-challenge/ http://${upstream}/.well-known/acme-challenge/
    ProxyPassReverse /.well-known/acme-challenge/ http://${upstream}/.well-known/acme-challenge/
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/.well-known/acme-challenge/
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName ${hostname}
    SSLEngine on
    SSLCertificateFile ${cert}
    SSLCertificateKeyFile ${key}
    ProxyPreserveHost On
    AllowEncodedSlashes NoDecode
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass / http://${upstream}/
    ProxyPassReverse / http://${upstream}/
</VirtualHost>`,
  }
}

export async function acmeEmail(config: ServerConfig, hostname: string): Promise<string> {
  try {
    const users = await loadUsers(config)
    const admin = users.find((user) => user.role === 'admin' && user.email.includes('@'))
    if (admin) return admin.email
  } catch {
    // not configured yet
  }
  return `admin@${hostname}`
}

export function certPaths(config: ServerConfig) {
  return {
    accountKey: `${config.certsDir}/account.key`,
    cert: `${config.certsDir}/fullchain.pem`,
    key: `${config.certsDir}/privkey.pem`,
  }
}
