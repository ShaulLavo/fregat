import { useDelayedVisible } from '@workspace/ui/hooks/use-delayed-visible'
import { cn } from '@workspace/ui/lib/utils'

// A socket that is back within this reconnected; a notice for a frame reads as a failure.
const NOTICE_DELAY_MS = 600

/** Over saved or frozen output while the terminal socket is away. */
export function ConnectionNotice({ restarting }: { readonly restarting: boolean }) {
  const visible = useDelayedVisible(NOTICE_DELAY_MS)
  if (!visible) return null

  return (
    <p
      role='status'
      className={cn(
        'bg-popover-solid absolute right-0 bottom-0 px-2 py-1 text-xs',
        restarting ? 'text-muted-foreground' : 'text-warning',
      )}
    >
      {restarting
        ? 'Server restarting. The terminal reconnects when it is back.'
        : 'Terminal connection pending. Saved output is read-only.'}
    </p>
  )
}
