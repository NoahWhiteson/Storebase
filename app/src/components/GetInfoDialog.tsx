import { FileGlyph } from '@/components/FileGlyph'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchFileInfo, isTempId, type FileInfo } from '@/lib/api'
import { formatBytes, formatDateTime, formatExactBytes } from '@/lib/format'
import type { DriveItem } from '@/types'
import { useEffect, useState } from 'react'

function whereLabel(item: DriveItem, info: FileInfo): string {
  if (item.id.startsWith('share:')) {
    return item.shareName ? `Shared · ${item.shareName}` : 'Shared with me'
  }
  if (isTempId(item.id)) {
    const rest = item.id === '.temp' ? '' : item.id.slice('.temp/'.length)
    const slash = rest.lastIndexOf('/')
    const parent = slash === -1 ? '' : rest.slice(0, slash)
    return parent ? `Temp / ${parent}` : 'Temp'
  }
  if (item.trashed || info.path.startsWith('.trash/')) return 'Trash'
  const slash = info.path.lastIndexOf('/')
  const parent = slash === -1 ? '' : info.path.slice(0, slash)
  return parent || 'My files'
}

function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5">
      <dt className="text-xs text-[#8d8d8d]">{label}</dt>
      <dd className="min-w-0 text-sm text-[#e8e8e8]">
        <span className="break-words">{value}</span>
        {detail ? <span className="mt-0.5 block text-xs text-[#8d8d8d]">{detail}</span> : null}
      </dd>
    </div>
  )
}

export function GetInfoDialog({ item, onClose }: { item: DriveItem; onClose: () => void }) {
  const [info, setInfo] = useState<FileInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let gone = false
    setInfo(null)
    setError(null)
    void fetchFileInfo(item.id)
      .then((next) => {
        if (!gone) setInfo(next)
      })
      .catch((err) => {
        if (!gone) setError(err instanceof Error ? err.message : 'Could not load info')
      })
    return () => {
      gone = true
    }
  }, [item.id])

  const driveBytes = info ? info.allocated + info.versionsBytes : 0
  const kindLine = info
    ? info.type === 'folder'
      ? info.fileCount + info.folderCount === 0
        ? 'Folder · empty'
        : `Folder · ${info.fileCount + info.folderCount} item${info.fileCount + info.folderCount === 1 ? '' : 's'}`
      : info.extension
        ? `${info.kind} · .${info.extension}`
        : info.kind
    : item.kind === 'folder'
      ? 'Folder'
      : item.name.includes('.')
        ? item.name.slice(item.name.lastIndexOf('.'))
        : 'File'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <FileGlyph kind={item.kind} size="sm" />
            <div className="min-w-0">
              <DialogTitle className="truncate">{item.name}</DialogTitle>
              <DialogDescription className="truncate text-[#8d8d8d]">{kindLine}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error ? <p className="text-sm text-[#f28b82]">{error}</p> : null}
        {!info && !error ? <p className="text-sm text-[#8d8d8d]">Reading size…</p> : null}

        {info ? (
          <dl>
            <Row label="Size" value={formatBytes(info.size)} detail={formatExactBytes(info.size)} />
            <Row
              label="On the drive"
              value={formatBytes(driveBytes)}
              detail={
                info.versions
                  ? `${formatExactBytes(driveBytes)} · ${info.versions} older version${info.versions === 1 ? '' : 's'}`
                  : formatExactBytes(driveBytes)
              }
            />
            <Row
              label="On a Mac"
              value={formatBytes(info.deviceBytes)}
              detail="Cloud copy until you open it"
            />
            <Row label="Where" value={whereLabel(item, info)} />
            <Row label="Created" value={formatDateTime(info.createdAt)} />
            <Row label="Modified" value={formatDateTime(info.modifiedAt)} />
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
