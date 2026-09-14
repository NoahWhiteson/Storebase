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

export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return DATE_TIME_FMT.format(new Date(iso))
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
