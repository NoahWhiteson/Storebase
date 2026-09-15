export type FileKind =
  | 'folder'
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'zip'

export type SectionId =
  | 'home'
  | 'my-drive'
  | 'shared'
  | 'recent'
  | 'starred'
  | 'temp'
  | 'spam'
  | 'trash'

export type DriveItem = {
  id: string
  name: string
  kind: FileKind
  parentId: string | null
  owner: string
  ownerInitials: string
  modifiedAt: string
  size: number | null
  starred: boolean
  shared: boolean
  trashed: boolean
  spam: boolean
  computer: boolean
  owned?: boolean
  daysLeft?: number
  expiresAt?: string
  shareId?: string
  shareName?: string
}
