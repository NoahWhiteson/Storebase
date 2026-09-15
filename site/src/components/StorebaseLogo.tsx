import { cn } from '@/lib/utils'

export function StorebaseLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn('shrink-0', className)}>
      <path fill="#e8e8e8" d="M16 3.2 28.4 10.4 16 17.6 3.6 10.4 16 3.2Z" />
      <path fill="#b3b3b3" d="M3.6 10.4 16 17.6v11.2L3.6 21.6V10.4Z" />
      <path fill="#8d8d8d" d="M16 17.6 28.4 10.4v11.2L16 28.8V17.6Z" />
    </svg>
  )
}
