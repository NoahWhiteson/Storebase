const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  const digits = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[i]}`
}

export function formatExactBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} byte${bytes === 1 ? '' : 's'}`
}

export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return DATE_TIME_FMT.format(new Date(iso))
}

export function formatRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'Expires now'
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (ms < hour) {
    const mins = Math.max(1, Math.round(ms / minute))
    return `${mins} min left`
  }
  if (ms < 2 * day) {
    const hours = Math.max(1, Math.round(ms / hour))
    return `${hours} hour${hours === 1 ? '' : 's'} left`
  }
  const days = Math.max(1, Math.round(ms / day))
  return `${days} day${days === 1 ? '' : 's'} left`
}

export function formatTtl(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = hours / 24
  if (Number.isInteger(days)) return `${days} day${days === 1 ? '' : 's'}`
  return `${hours} hours`
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const delta = now - then
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < hour) {
    const mins = Math.max(1, Math.round(delta / minute))
    return `${mins} min ago`
  }
  if (delta < day) {
    const hours = Math.round(delta / hour)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  if (delta < 7 * day) {
    const days = Math.round(delta / day)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }
  return formatDate(iso)
}
