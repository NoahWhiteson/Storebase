import type { FileKind } from '@/types'
import {
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Image,
  Presentation,
  File,
  AppWindow,
  Disc3,
  Package,
  Smartphone,
  SquareTerminal,
  Coffee,
  Braces,
  CodeXml,
  Database,
  Gem,
  Download,
  Code2,
  Music2,
  Archive,
  BriefcaseBusiness,
} from 'lucide-react'

const styles: Record<FileKind, { icon: typeof Folder; color: string; bg: string }> = {
  folder: { icon: Folder, color: '#fbbc04', bg: 'rgba(251,188,4,0.12)' },
  doc: { icon: FileText, color: '#8ab4f8', bg: 'rgba(138,180,248,0.12)' },
  sheet: { icon: FileSpreadsheet, color: '#81c995', bg: 'rgba(129,201,149,0.12)' },
  slide: { icon: Presentation, color: '#fdd663', bg: 'rgba(253,214,99,0.12)' },
  pdf: { icon: FileText, color: '#f28b82', bg: 'rgba(242,139,130,0.12)' },
  image: { icon: Image, color: '#78d9ec', bg: 'rgba(120,217,236,0.12)' },
  video: { icon: Film, color: '#f28b82', bg: 'rgba(242,139,130,0.12)' },
  audio: { icon: FileAudio, color: '#fdd663', bg: 'rgba(253,214,99,0.12)' },
  zip: { icon: FileArchive, color: '#bdc1c6', bg: 'rgba(189,193,198,0.12)' },
  app: { icon: AppWindow, color: '#8ab4f8', bg: 'rgba(138,180,248,0.12)' },
}

function appStyle(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jar', 'war'].includes(ext)) return { icon: Coffee, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
  if (['dmg', 'pkg', 'appimage', 'deb', 'rpm'].includes(ext)) return { icon: Package, color: '#c4b5fd', bg: 'rgba(196,181,253,0.12)' }
  if (['apk', 'aab', 'xapk', 'ipa'].includes(ext)) return { icon: Smartphone, color: '#81c995', bg: 'rgba(129,201,149,0.12)' }
  if (ext === 'iso') return { icon: Disc3, color: '#e8eaed', bg: 'rgba(232,234,237,0.12)' }
  if (['bat', 'cmd', 'ps1'].includes(ext)) return { icon: SquareTerminal, color: '#a7f3d0', bg: 'rgba(167,243,208,0.12)' }
  return styles.app
}

const folderPalette = [
  { color: '#8ab4f8', bg: 'rgba(138,180,248,.14)' },
  { color: '#c4b5fd', bg: 'rgba(196,181,253,.14)' },
  { color: '#78d9ec', bg: 'rgba(120,217,236,.14)' },
  { color: '#81c995', bg: 'rgba(129,201,149,.14)' },
  { color: '#f28b82', bg: 'rgba(242,139,130,.14)' },
  { color: '#fdd663', bg: 'rgba(253,214,99,.14)' },
]

function folderStyle(name: string) {
  const base = name.trim().toLowerCase()
  if (/^(downloads?|incoming)$/.test(base)) return { icon: Download, ...folderPalette[0] }
  if (/^(code|source|src|projects?|repos?|development)$/.test(base)) return { icon: Code2, ...folderPalette[1] }
  if (/^(photos?|pictures?|images?)$/.test(base)) return { icon: Image, ...folderPalette[2] }
  if (/^(videos?|movies?)$/.test(base)) return { icon: Film, ...folderPalette[4] }
  if (/^(music|audio)$/.test(base)) return { icon: Music2, ...folderPalette[3] }
  if (/^(archives?|backups?)$/.test(base)) return { icon: Archive, ...folderPalette[5] }
  if (/^(work|business|clients?)$/.test(base)) return { icon: BriefcaseBusiness, ...folderPalette[1] }
  let hash = 0
  for (const character of base) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return { icon: Folder, ...folderPalette[hash % folderPalette.length] }
}

const codeBadges: Record<string, { label?: string; icon?: typeof File; color: string; bg: string }> = {
  js: { label: 'JS', color: '#f7df1e', bg: 'rgba(247,223,30,.13)' }, jsx: { label: 'JS', color: '#61dafb', bg: 'rgba(97,218,251,.12)' },
  ts: { label: 'TS', color: '#3178c6', bg: 'rgba(49,120,198,.16)' }, tsx: { label: 'TS', color: '#61dafb', bg: 'rgba(97,218,251,.12)' },
  py: { label: 'PY', color: '#ffd43b', bg: 'rgba(55,118,171,.2)' }, java: { icon: Coffee, color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
  html: { icon: CodeXml, color: '#e34f26', bg: 'rgba(227,79,38,.13)' }, htm: { icon: CodeXml, color: '#e34f26', bg: 'rgba(227,79,38,.13)' },
  css: { label: 'CSS', color: '#1572b6', bg: 'rgba(21,114,182,.16)' }, scss: { label: 'SC', color: '#cc6699', bg: 'rgba(204,102,153,.14)' },
  json: { icon: Braces, color: '#f3f4f6', bg: 'rgba(243,244,246,.1)' }, yaml: { label: 'Y', color: '#cb171e', bg: 'rgba(203,23,30,.14)' }, yml: { label: 'Y', color: '#cb171e', bg: 'rgba(203,23,30,.14)' },
  c: { label: 'C', color: '#a8b9cc', bg: 'rgba(168,185,204,.13)' }, h: { label: 'C', color: '#a8b9cc', bg: 'rgba(168,185,204,.13)' }, cpp: { label: 'C++', color: '#659ad2', bg: 'rgba(101,154,210,.14)' },
  cs: { label: 'C#', color: '#9b4f96', bg: 'rgba(155,79,150,.15)' }, go: { label: 'GO', color: '#00add8', bg: 'rgba(0,173,216,.13)' }, rs: { label: 'RS', color: '#dea584', bg: 'rgba(222,165,132,.13)' },
  rb: { icon: Gem, color: '#cc342d', bg: 'rgba(204,52,45,.13)' }, php: { label: 'PHP', color: '#777bb4', bg: 'rgba(119,123,180,.15)' },
  swift: { label: 'SW', color: '#f05138', bg: 'rgba(240,81,56,.13)' }, kt: { label: 'KT', color: '#a97bff', bg: 'rgba(169,123,255,.13)' },
  sql: { icon: Database, color: '#8ab4f8', bg: 'rgba(138,180,248,.12)' }, sh: { icon: SquareTerminal, color: '#a7f3d0', bg: 'rgba(167,243,208,.12)' },
  bash: { icon: SquareTerminal, color: '#a7f3d0', bg: 'rgba(167,243,208,.12)' }, vue: { label: 'V', color: '#42b883', bg: 'rgba(66,184,131,.13)' },
}

const fileBadges: Record<string, { label: string; color: string; bg: string }> = {
  pdf: { label: 'PDF', color: '#f28b82', bg: 'rgba(242,139,130,.13)' },
  doc: { label: 'W', color: '#2b7cd3', bg: 'rgba(43,124,211,.16)' }, docx: { label: 'W', color: '#2b7cd3', bg: 'rgba(43,124,211,.16)' },
  xls: { label: 'X', color: '#21a366', bg: 'rgba(33,163,102,.15)' }, xlsx: { label: 'X', color: '#21a366', bg: 'rgba(33,163,102,.15)' }, csv: { label: 'CSV', color: '#21a366', bg: 'rgba(33,163,102,.15)' },
  ppt: { label: 'P', color: '#d24726', bg: 'rgba(210,71,38,.15)' }, pptx: { label: 'P', color: '#d24726', bg: 'rgba(210,71,38,.15)' },
  zip: { label: 'ZIP', color: '#d1d5db', bg: 'rgba(209,213,219,.1)' }, rar: { label: 'RAR', color: '#c4b5fd', bg: 'rgba(196,181,253,.12)' }, '7z': { label: '7Z', color: '#d1d5db', bg: 'rgba(209,213,219,.1)' },
}

export function FileGlyph({
  kind,
  name = '',
  size = 'md',
}: {
  kind: FileKind
  name?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const base = name.toLowerCase()
  const codeStyle = codeBadges[ext] ?? (base === 'dockerfile' ? { label: 'DK', color: '#2496ed', bg: 'rgba(36,150,237,.14)' } : base === 'makefile' ? { label: 'MK', color: '#a7f3d0', bg: 'rgba(167,243,208,.12)' } : undefined)
  const nativeStyle = codeStyle ?? fileBadges[ext]
  const { icon: Icon = File, color, bg, label } = nativeStyle ?? (kind === 'folder' ? folderStyle(name) : kind === 'app' ? appStyle(name) : styles[kind]) ?? {
    icon: File,
    color: '#bdc1c6',
    bg: 'rgba(189,193,198,0.12)',
  }
  const box =
    size === 'lg' ? 'size-16 rounded-2xl' : size === 'sm' ? 'size-8 rounded-md' : 'size-12 rounded-xl'
  const glyph = size === 'lg' ? 'size-8' : size === 'sm' ? 'size-4' : 'size-6'
  const windowsApp = kind === 'app' && ['exe', 'msi', 'dll', 'lnk', 'scr', 'com'].includes(ext)

  return (
    <span
      className={`inline-flex items-center justify-center ${box}`}
      style={{ background: bg, color }}
    >
      {label ? <span className={`${size === 'sm' ? 'text-[8px]' : size === 'lg' ? 'text-sm' : 'text-[10px]'} font-black tracking-tight`}>{label}</span> : windowsApp ? (
        <span className={`${glyph} grid grid-cols-2 gap-[1px]`} aria-hidden="true">
          <span className="bg-[#00a4ef]" /><span className="bg-[#00a4ef]" />
          <span className="bg-[#00a4ef]" /><span className="bg-[#00a4ef]" />
        </span>
      ) : <Icon className={glyph} strokeWidth={1.7} />}
    </span>
  )
}

export function kindLabel(kind: FileKind): string {
  const labels: Record<FileKind, string> = {
    folder: 'Folder',
    doc: 'Document',
    sheet: 'Spreadsheet',
    slide: 'Presentation',
    pdf: 'PDF',
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    zip: 'Archive',
    app: 'Application',
  }
  return labels[kind]
}
