import { cpus, loadavg, platform } from 'node:os'

export type RequestTiming = {
  method: string
  path: string
  status: number
  durationMs: number
  at: string
}

export type SettingsTiming = {
  section: string
  baseMs: number
  detailMs: number
  totalMs: number
  at: string
}

const requests: RequestTiming[] = []
const settings: SettingsTiming[] = []
const MAX_REQUESTS = 240
const MAX_SETTINGS = 40

export function recordRequest(timing: RequestTiming): void {
  requests.push(timing)
  if (requests.length > MAX_REQUESTS) requests.splice(0, requests.length - MAX_REQUESTS)
}

export function recordSettingsTiming(timing: SettingsTiming): void {
  settings.push(timing)
  if (settings.length > MAX_SETTINGS) settings.splice(0, settings.length - MAX_SETTINGS)
}

function percentile(values: number[], amount: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * amount) - 1))] ?? 0
}

export function diagnosticsSnapshot(cache: Record<string, number>) {
  const grouped = new Map<string, RequestTiming[]>()
  for (const request of requests) {
    const key = `${request.method} ${request.path}`
    const list = grouped.get(key) ?? []
    list.push(request)
    grouped.set(key, list)
  }
  const endpoints = [...grouped.entries()]
    .map(([path, samples]) => {
      const durations = samples.map((sample) => sample.durationMs)
      return {
        path,
        count: samples.length,
        averageMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
        p95Ms: percentile(durations, 0.95),
        maxMs: Math.max(...durations),
        lastMs: durations[durations.length - 1] ?? 0,
        errors: samples.filter((sample) => sample.status >= 400).length,
      }
    })
    .sort((a, b) => b.p95Ms - a.p95Ms)
  const memory = process.memoryUsage()
  return {
    generatedAt: new Date().toISOString(),
    process: {
      uptimeSeconds: process.uptime(),
      nodeVersion: process.version,
      platform: `${platform()} ${process.arch}`,
      cpuCount: cpus().length,
      loadAverage: loadavg(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
    },
    cache,
    endpoints,
    settings: [...settings].reverse(),
    recent: [...requests].reverse().slice(0, 40),
  }
}
