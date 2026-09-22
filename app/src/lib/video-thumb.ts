const memory = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
const MAX_SIDE = 480
const CONCURRENCY = 2
let active = 0
const waiters: Array<() => void> = []

function storageKey(url: string): string {
  return `sb-vthumb:${url}`
}

export function cachedThumb(url: string): string | null {
  const hit = memory.get(url)
  if (hit) return hit
  try {
    const stored = sessionStorage.getItem(storageKey(url))
    if (stored) {
      memory.set(url, stored)
      return stored
    }
  } catch {
    // private mode / quota
  }
  return null
}

function remember(url: string, data: string): void {
  memory.set(url, data)
  try {
    sessionStorage.setItem(storageKey(url), data)
  } catch {
    // ignore
  }
}

function lock(): Promise<void> {
  if (active < CONCURRENCY) {
    active += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1
      resolve()
    })
  })
}

function unlock(): void {
  active = Math.max(0, active - 1)
  const next = waiters.shift()
  if (next) next()
}

export function captureVideoThumb(url: string): Promise<string> {
  const existing = cachedThumb(url)
  if (existing) return Promise.resolve(existing)
  const pending = inflight.get(url)
  if (pending) return pending

  const job = (async () => {
    await lock()
    try {
      const again = cachedThumb(url)
      if (again) return again
      const data = await grabFrame(url)
      remember(url, data)
      return data
    } finally {
      inflight.delete(url)
      unlock()
    }
  })()
  inflight.set(url, job)
  return job
}

function grabFrame(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'use-credentials'
    let settled = false

    const fail = () => {
      if (settled) return
      settled = true
      video.removeAttribute('src')
      video.load()
      reject(new Error('Could not capture thumbnail'))
    }

    const done = () => {
      if (settled) return
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) {
        fail()
        return
      }
      const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        fail()
        return
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const data = canvas.toDataURL('image/jpeg', 0.74)
        settled = true
        video.removeAttribute('src')
        video.load()
        resolve(data)
      } catch {
        fail()
      }
    }

    video.addEventListener('error', fail)
    video.addEventListener('loadeddata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const t = duration > 0.4 ? Math.min(1, duration * 0.08) : 0
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        done()
      }
      video.addEventListener('seeked', onSeeked)
      try {
        video.currentTime = t
      } catch {
        fail()
      }
    })
    window.setTimeout(fail, 12_000)
    video.src = url
  })
}
