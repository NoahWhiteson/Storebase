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
  if (['dmg', 'pkg', 'appimage', 'deb', 'rpm', 'jar', 'war'].includes(ext)) return { icon: Package, color: '#c4b5fd', bg: 'rgba(196,181,253,0.12)' }
  if (['apk', 'aab', 'xapk', 'ipa'].includes(ext)) return { icon: Smartphone, color: '#81c995', bg: 'rgba(129,201,149,0.12)' }
  if (ext === 'iso') return { icon: Disc3, color: '#e8eaed', bg: 'rgba(232,234,237,0.12)' }
  if (['bat', 'cmd', 'ps1'].includes(ext)) return { icon: SquareTerminal, color: '#a7f3d0', bg: 'rgba(167,243,208,0.12)' }
  return styles.app
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
  const { icon: Icon, color, bg } = (kind === 'app' ? appStyle(name) : styles[kind]) ?? {
    icon: File,
    color: '#bdc1c6',
    bg: 'rgba(189,193,198,0.12)',
  }
  const box =
    size === 'lg' ? 'size-16 rounded-2xl' : size === 'sm' ? 'size-8 rounded-md' : 'size-12 rounded-xl'
  const glyph = size === 'lg' ? 'size-8' : size === 'sm' ? 'size-4' : 'size-6'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const windowsApp = kind === 'app' && ['exe', 'msi', 'dll', 'lnk', 'scr', 'com'].includes(ext)

  return (
    <span
      className={`inline-flex items-center justify-center ${box}`}
      style={{ background: bg, color }}
    >
      {windowsApp ? (
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
