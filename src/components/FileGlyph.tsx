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
}

export function FileGlyph({
  kind,
  size = 'md',
}: {
  kind: FileKind
  size?: 'sm' | 'md' | 'lg'
}) {
  const { icon: Icon, color, bg } = styles[kind] ?? {
    icon: File,
    color: '#bdc1c6',
    bg: 'rgba(189,193,198,0.12)',
  }
  const box =
    size === 'lg' ? 'size-16 rounded-2xl' : size === 'sm' ? 'size-8 rounded-md' : 'size-12 rounded-xl'
  const glyph = size === 'lg' ? 'size-8' : size === 'sm' ? 'size-4' : 'size-6'

  return (
    <span
      className={`inline-flex items-center justify-center ${box}`}
      style={{ background: bg, color }}
    >
      <Icon className={glyph} strokeWidth={1.7} />
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
  }
  return labels[kind]
}
