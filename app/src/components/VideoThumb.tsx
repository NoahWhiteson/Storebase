import { cachedThumb, captureVideoThumb } from '@/lib/video-thumb'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'

export function VideoThumb({ url, className }: { url: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(() => cachedThumb(url))
  const host = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    setSrc(cachedThumb(url))
    let gone = false
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void captureVideoThumb(url).then(data => { if (!gone) setSrc(data) }).catch(() => { if (!gone) setSrc(null) })
    }, { rootMargin: '160px' })
    if (host.current) observer.observe(host.current)
    return () => { gone = true; observer.disconnect() }
  }, [url])

  return <span ref={host} className={cn('block overflow-hidden bg-[#141414]', className)}>
    {src && <img src={src} alt="" decoding="async" className="h-full w-full object-cover" />}
  </span>
}
