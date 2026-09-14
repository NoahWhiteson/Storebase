import { formatBytes, formatRelative } from '@/lib/format'
import type { DriveItem } from '@/types'

export function answerQuery(query: string, items: DriveItem[]): string {
  const q = query.trim().toLowerCase()
  const live = items.filter((item) => !item.trashed && !item.spam)

  if (!q) return 'Ask about a file, folder, or what’s eating storage.'

  if (/space|storage|largest|big|size/.test(q)) {
    const ranked = [...live]
      .filter((item) => item.size)
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      .slice(0, 5)
    if (!ranked.length) return 'No file sizes on record yet.'
    const lines = ranked.map((item) => `• ${item.name} — ${formatBytes(item.size)}`)
    return `Heaviest files:\n${lines.join('\n')}`
  }

  if (/star/.test(q)) {
    const starred = live.filter((item) => item.starred)
    if (!starred.length) return 'Nothing starred. Star a file and I’ll keep it on the short list.'
    return `Starred:\n${starred.map((item) => `• ${item.name}`).join('\n')}`
  }

  if (/share/.test(q)) {
    const shared = live.filter((item) => item.shared)
    if (!shared.length) return 'Nothing shared right now.'
    return `Shared:\n${shared.map((item) => `• ${item.name} (${item.owner})`).join('\n')}`
  }

  if (/recent|latest|new/.test(q)) {
    const recent = [...live]
      .sort((a, b) => +new Date(b.modifiedAt) - +new Date(a.modifiedAt))
      .slice(0, 6)
    return `Latest activity:\n${recent.map((item) => `• ${item.name} — ${formatRelative(item.modifiedAt)}`).join('\n')}`
  }

  if (/image|photo|jpg|png/.test(q)) {
    const images = live.filter((item) => item.kind === 'image')
    if (!images.length) return 'No images in Storebase.'
    return `Images:\n${images.map((item) => `• ${item.name}`).join('\n')}`
  }

  if (/video|mp4|film/.test(q)) {
    const videos = live.filter((item) => item.kind === 'video')
    if (!videos.length) return 'No videos in Storebase.'
    return `Videos:\n${videos.map((item) => `• ${item.name} — ${formatBytes(item.size)}`).join('\n')}`
  }

  const tokens = q.split(/\s+/).filter((t) => t.length > 1)
  const hits = live.filter((item) =>
    tokens.some((token) => item.name.toLowerCase().includes(token) || item.kind.includes(token)),
  )
  if (hits.length) {
    return `Matched ${hits.length} item${hits.length === 1 ? '' : 's'}:\n${hits
      .slice(0, 8)
      .map((item) => `• ${item.name} — ${item.owner}`)
      .join('\n')}`
  }

  return `No file named like that. Try a folder name, “starred”, or “what’s using space”.`
}
