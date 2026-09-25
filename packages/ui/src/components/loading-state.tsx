import { useDelayedVisible } from '@workspace/ui/hooks/use-delayed-visible'
import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * The shared contract for "this is still fetching". Features supply the visual
 * structure that matches their loaded content; this shell owns the accessible
 * status and the delay that prevents fast requests from flashing placeholders.
 *
 * `label` is the accessible name only — nothing is drawn for it.
 *
 * The busy container mounts immediately so assistive tech is told right away;
 * only the visual preview waits out `delayMs`, which keeps a fast query from
 * flashing placeholder content.
 *
 * Never wrap a loader: `Spinner` is its own `role="status"`,
 * so nesting one announces the wait twice and delays the mark itself.
 */
function LoadingState({
  children,
  className,
  delayMs = 120,
  label,
}: {
  children: ReactNode
  className?: string
  delayMs?: number
  label: string
}) {
  const visible = useDelayedVisible(delayMs)

  return (
    <div
      aria-busy='true'
      aria-label={label}
      className={cn('min-h-0', className)}
      data-slot='loading-state'
      role='status'
    >
      {visible ? children : null}
    </div>
  )
}

export { LoadingState }
