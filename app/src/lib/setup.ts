export type DiskInfo = {
  totalBytes: number
  freeBytes: number
}

export type PublicUser = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
}

export type SetupState =
  | {
      configured: false
      hostname?: string
      disk: DiskInfo
    }
  | {
      configured: true
      admin: PublicUser | null
      reservedBytes: number
      disk: DiskInfo
    }

export async function fetchSetup(): Promise<SetupState> {
  const res = await fetch('/api/setup')
  if (!res.ok) throw new Error('Could not reach the Storebase node')
  return res.json() as Promise<SetupState>
}

export async function submitSetup(payload: {
  admin: { name: string; email: string; password: string }
  reserveGb: number
  users: { name: string; email: string; password: string }[]
}): Promise<{ admin: PublicUser; reservedBytes: number }> {
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json()) as { error?: string; admin?: PublicUser; reservedBytes?: number }
  if (!res.ok || !body.admin || body.reservedBytes == null) {
    throw new Error(body.error ?? 'Setup failed')
  }
  return { admin: body.admin, reservedBytes: body.reservedBytes }
}
