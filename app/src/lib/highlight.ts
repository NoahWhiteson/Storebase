import { extOf } from '@/lib/preview'

const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'sql', 'kt', 'swift', 'php', 'lua', 'r', 'pl', 'ps1',
  'html', 'htm', 'xml', 'css', 'scss', 'less', 'vue', 'svelte', 'json', 'env', 'ini', 'cfg', 'conf',
  'dockerfile', 'gitignore', 'mdx',
])

const KEYWORDS = /^(?:abstract|async|await|break|case|catch|class|const|continue|def|delete|do|else|enum|export|extends|finally|for|from|func|function|if|implements|import|in|interface|let|match|new|package|private|protected|public|return|select|static|struct|switch|throw|try|type|typeof|var|void|while|with|yield)$/
const LITERALS = /^(?:true|false|null|undefined|None|True|False|nil)$/

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function isCodeName(name: string): boolean {
  return CODE_EXTENSIONS.has(extOf(name))
}

export function highlightCode(source: string, name: string): string {
  const ext = extOf(name)
  const hashComments = ['py', 'rb', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'r'].includes(ext)
  const pattern = new RegExp(
    `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|//[^\\n]*|/\\*[\\s\\S]*?\\*/${hashComments ? '|#[^\\n]*' : ''}|<\\/?[A-Za-z][^>]*>|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][\\w$]*\\b)`,
    'g',
  )
  let html = ''
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0
    html += escapeHtml(source.slice(cursor, index))
    const token = match[0]
    let kind = ''
    if (token.startsWith('//') || token.startsWith('/*') || (hashComments && token.startsWith('#'))) kind = 'comment'
    else if (/^["'`]/.test(token)) kind = 'string'
    else if (/^\d/.test(token)) kind = 'number'
    else if (LITERALS.test(token)) kind = 'literal'
    else if (KEYWORDS.test(token) || token.startsWith('<')) kind = 'keyword'
    html += kind ? `<span class="syntax-${kind}">${escapeHtml(token)}</span>` : escapeHtml(token)
    cursor = index + token.length
  }
  return html + escapeHtml(source.slice(cursor))
}
