import { FileGlyph } from '@/components/FileGlyph'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="pt-0.5 text-xs text-[#8d8d8d]">{label}</dt>
      <dd className="min-w-0">
        <div className="break-words text-sm text-[#e8e8e8]">{value}</div>
        {hint ? <div className="mt-0.5 text-xs leading-relaxed text-[#8d8d8d]">{hint}</div> : null}
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
  const contents =
    info?.type === 'folder'
      ? info.fileCount + info.folderCount === 0
        ? 'Empty'
        : `${info.fileCount + info.folderCount} item${info.fileCount + info.folderCount === 1 ? '' : 's'} · ${info.fileCount} file${info.fileCount === 1 ? '' : 's'}, ${info.folderCount} folder${info.folderCount === 1 ? '' : 's'}`
      : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-[#2a2a2a] bg-[#1a1a1a] text-white sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <FileGlyph kind={item.kind} size="sm" />
            <div className="min-w-0">
              <DialogTitle className="truncate">{item.name}</DialogTitle>
              <DialogDescription className="text-[#8d8d8d]">Get Info</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error ? <p className="text-sm text-[#f28b82]">{error}</p> : null}
        {!info && !error ? <p className="text-sm text-[#8d8d8d]">Reading size on the drive…</p> : null}

        {info ? (
          <dl className="divide-y divide-white/10">
            <Row label="Kind" value={info.kind} />
            <Row
              label="Type"
              value={info.type === 'folder' ? 'Folder' : info.extension ? `.${info.extension} · ${info.mime}` : info.mime}
            />
            {contents ? <Row label="Contents" value={contents} /> : null}
            <Row
              label="Size"
              value={`${formatBytes(info.size)} (${formatExactBytes(info.size)})`}
            />
            <Row
              label="On the drive"
              value={`${formatBytes(driveBytes)} (${formatExactBytes(driveBytes)})`}
              hint={
                info.versions
                  ? `Includes ${info.versions} older version${info.versions === 1 ? '' : 's'} (${formatBytes(info.versionsBytes)}).`
                  : info.allocated !== info.size
                    ? 'Allocated blocks on the node disk, which can be a bit larger than the file.'
                    : undefined
              }
            />
            <Row
              label="On a Mac"
              value={`${formatBytes(info.deviceBytes)} (${formatExactBytes(info.deviceBytes)})`}
              hint={
                info.type === 'folder'
                  ? info.fileCount === 0
                    ? 'Folders themselves stay empty locally until you open files inside.'
                    : 'Storebase keeps each file as a cloud copy until you open it.'
                  : 'Cloud copy size. Opening the file in Storebase downloads the full thing.'
              }
            />
            <Row label="Where" value={whereLabel(item, info)} />
            <Row label="Created" value={formatDateTime(info.createdAt)} />
            <Row label="Modified" value={formatDateTime(info.modifiedAt)} />
          </dl>
        ) : null}

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
