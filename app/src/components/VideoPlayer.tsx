import { cachedThumb } from '@/lib/video-thumb'
import { cn } from 'cn'
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function VideoPlayer({ src, title }: { src: string; title: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideRef = useRef<number>(0)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [fs, setFs] = useState(false)
  const [chrome, setChrome] = useState(true)
  const poster = cachedThumb(src)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [muted, volume])

  useEffect(() => {
    function onFs() {
      setFs(document.fullscreenElement === wrapRef.current)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const video = videoRef.current
      if (!video) return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        toggle()
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        video.currentTime = Math.max(0, video.currentTime - 5)
      }
      if (e.key === 'm') {
        e.preventDefault()
        setMuted((on) => !on)
      }
      if (e.key === 'f') {
        e.preventDefault()
        void toggleFs()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function bumpChrome() {
    setChrome(true)
    window.clearTimeout(hideRef.current)
    hideRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setChrome(false)
    }, 2200)
  }

  function toggle() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play()
      setPlaying(true)
      bumpChrome()
    } else {
      video.pause()
      setPlaying(false)
      setChrome(true)
    }
  }

  async function toggleFs() {
    const node = wrapRef.current
    if (!node) return
    if (document.fullscreenElement === node) await document.exitFullscreen()
    else await node.requestFullscreen()
  }

  const playedPct = duration > 0 ? (current / duration) * 100 : 0
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto flex h-full w-full max-w-6xl items-center justify-center bg-black"
      onMouseMove={bumpChrome}
      onMouseLeave={() => {
        if (playing) setChrome(false)
      }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        className="max-h-full max-w-full"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          setChrome(true)
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget
          setCurrent(el.currentTime)
          if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1))
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
      />

      {!playing ? (
        <button
          type="button"
          aria-label={`Play ${title}`}
          onClick={toggle}
          className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#1a1a1a]"
        >
          <Play className="size-7 fill-current" />
        </button>
      ) : null}

      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pt-16 pb-3 transition-opacity',
          chrome ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="pointer-events-auto">
          <div
            className="group relative h-5 cursor-pointer"
            onPointerDown={(e) => {
              const track = e.currentTarget
              const seek = (clientX: number) => {
                const video = videoRef.current
                if (!video || !duration) return
                const rect = track.getBoundingClientRect()
                const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
                video.currentTime = t * duration
                setCurrent(video.currentTime)
              }
              seek(e.clientX)
              const move = (ev: PointerEvent) => seek(ev.clientX)
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full bg-white/20">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${bufPct}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${playedPct}%` }} />
            </div>
          </div>

          <div className="mt-1 flex items-center gap-2 text-white">
            <button type="button" aria-label={playing ? 'Pause' : 'Play'} className="flex size-9 items-center justify-center" onClick={toggle}>
              {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
            </button>
            <span className="min-w-[7rem] text-xs tabular-nums text-white/80">
              {clock(current)} / {clock(duration)}
            </span>
            <button
              type="button"
              aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
              className="flex size-9 items-center justify-center"
              onClick={() => setMuted((on) => !on)}
            >
              {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              aria-label="Volume"
              className="vp-range w-24"
              onChange={(e) => {
                const next = Number(e.target.value)
                setVolume(next)
                setMuted(next === 0)
              }}
            />
            <span className="flex-1" />
            <button
              type="button"
              aria-label={fs ? 'Exit full screen' : 'Full screen'}
              className="flex size-9 items-center justify-center"
              onClick={() => void toggleFs()}
            >
              {fs ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
