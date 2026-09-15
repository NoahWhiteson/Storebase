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
  owner: string
  modifiedAt: string
  size: number | null
  starred: boolean
  shared: boolean
  expiresAt?: string
}
