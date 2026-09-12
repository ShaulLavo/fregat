import { cn } from '@workspace/ui/lib/utils'

export function Status({ children, tone }: { children: string; tone?: 'destructive' }) {
  return (
    <p
      role='status'
      className={cn(
        'p-(--density-section-padding) text-sm',
        tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}
