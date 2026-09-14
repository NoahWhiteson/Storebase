import { FileGlyph, kindLabel } from '@/components/FileGlyph'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatBytes, formatDateTime } from '@/lib/format'
import type { DriveItem } from '@/types'
import { Star, Users, X } from 'lucide-react'

type DetailsPanelProps = {
  item: DriveItem | null
  location: string
  onClose: () => void
  onStar: (id: string) => void
}

export function DetailsPanel({ item, location, onClose, onStar }: DetailsPanelProps) {
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-[#2e2e2e] bg-[#1a1a1a] md:w-[320px]">
      <div className="flex h-14 items-center justify-between px-4">
        <h2 className="text-sm font-medium">Details</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">
          <X />
        </Button>
      </div>
      <Separator />
      {item ? (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-col items-center text-center">
            <FileGlyph kind={item.kind} size="lg" />
            <h3 className="mt-3 text-base font-medium break-all">{item.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{kindLabel(item.kind)}</p>
          </div>
          <div className="mt-6 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => onStar(item.id)}
            >
              <Star className={item.starred ? 'fill-[#fdd663] text-[#fdd663]' : undefined} />
              {item.starred ? 'Starred' : 'Star'}
            </Button>
            <Button variant="secondary" className="flex-1">
              <Users />
              Share
            </Button>
          </div>
          <Separator className="my-5" />
          <dl className="space-y-4 text-sm">
            <Row label="Type" value={kindLabel(item.kind)} />
            <Row label="Size" value={item.kind === 'folder' ? '—' : formatBytes(item.size)} />
            <Row label="Location" value={location} />
            <Row label="Modified" value={formatDateTime(item.modifiedAt)} />
            <div>
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="mt-2 flex items-center gap-2">
                <Avatar size="sm">
                  <AvatarFallback className="bg-[#2c2c2c] text-[10px]">{item.ownerInitials}</AvatarFallback>
                </Avatar>
                {item.owner}
              </dd>
            </div>
            {item.shared ? <Row label="Sharing" value="Shared" /> : null}
          </dl>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm font-medium">Select a file to see details</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Click anything in the list. Info, sharing, and location show up here.
          </p>
        </div>
      )}
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  )
}
