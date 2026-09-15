import { cachedThumb, captureVideoThumb } from '@/lib/video-thumb'
import { cn } from 'cn'
import { useEffect, useState } from 'react'

export function VideoThumb({ url, className }: { url: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(() => cachedThumb(url))

  useEffect(() => {
    setSrc(cachedThumb(url))
    let gone = false
    void captureVideoThumb(url)
      .then((data) => {
        if (!gone) setSrc(data)
      })
      .catch(() => {
        if (!gone) setSrc(null)
      })
    return () => {
      gone = true
    }
  }, [url])

  if (src) {
    return <img src={src} alt="" className={cn('bg-[#111] object-cover', className)} />
  }

  return <span className={cn('block bg-[#141414]', className)} />
}
