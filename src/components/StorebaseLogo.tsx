import { cn } from 'cn'

export function StorebaseLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      className={cn('object-contain mix-blend-lighten', className)}
    />
  )
}
