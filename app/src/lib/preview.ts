export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'sheet' | 'none'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'])
const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi', 'mpeg', 'mpg', '3gp'])
const AUDIO = new Set(['mp3', 'wav', 'aac', 'flac', 'ogg', 'oga', 'm4a'])
const MARKDOWN = new Set(['md', 'markdown'])
const SHEET = new Set(['csv', 'tsv'])
const TEXT = new Set([
  'txt',
  'json',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'sh',
  'bash',
  'zsh',
  'yml',
  'yaml',
  'toml',
  'ini',
  'env',
  'log',
  'sql',
  'kt',
  'swift',
  'php',
  'lua',
  'r',
  'pl',
  'ps1',
  'cfg',
  'conf',
  'gitignore',
  'dockerfile',
  'vue',
  'svelte',
  'scss',
  'less',
  'mdx',
])

export function extOf(name: string): string {
  const base = name.split('/').pop() ?? name
  if (!base.includes('.')) return base.toLowerCase()
  return (base.split('.').pop() ?? '').toLowerCase()
}

export function previewKind(name: string): PreviewKind {
  const ext = extOf(name)
  if (IMAGE.has(ext)) return 'image'
  if (VIDEO.has(ext)) return 'video'
  if (AUDIO.has(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (MARKDOWN.has(ext)) return 'markdown'
  if (SHEET.has(ext)) return 'sheet'
  if (TEXT.has(ext)) return 'text'
  return 'none'
}

export function isZipName(name: string): boolean {
  return extOf(name) === 'zip'
}

export function renderMarkdown(src: string): string {
  const escaped = src
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  const parts = escaped.split(/```/)
  let html = ''
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i]
    if (i % 2 === 1) {
      const nl = chunk.indexOf('\n')
      const body = nl === -1 ? chunk : chunk.slice(nl + 1)
      html += `<pre class="md-code">${body}</pre>`
      continue
    }
    html += chunk
      .split('\n')
      .map((line) => {
        if (/^### /.test(line)) return `<h3>${inline(line.slice(4))}</h3>`
        if (/^## /.test(line)) return `<h2>${inline(line.slice(3))}</h2>`
        if (/^# /.test(line)) return `<h1>${inline(line.slice(2))}</h1>`
        if (/^[-*] /.test(line)) return `<li>${inline(line.slice(2))}</li>`
        if (!line.trim()) return '<br/>'
        return `<p>${inline(line)}</p>`
      })
      .join('')
  }
  return html
}

function inline(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}
