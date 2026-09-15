import { cn } from '@/lib/utils'

export function StorebaseLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      className={cn('shrink-0 object-contain mix-blend-lighten', className)}
    />
  )
}
