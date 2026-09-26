import type { ComponentProps } from 'react'
import { cn } from '@workspace/ui/lib/utils'

export type StatusDotTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive'

const TONE_CLASS: Record<StatusDotTone, string> = {
  neutral: 'bg-muted-foreground/40',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
}

type StatusDotProps = Omit<ComponentProps<'span'>, 'children'> & {
  readonly tone?: StatusDotTone
  /** Breathes while the state is ongoing. Pure CSS, so a row that shows it never re-renders. */
  readonly live?: boolean
}

/**
 * The app's one status mark: a square in a status token. Colour lives only in the mark; the
 * words beside it stay foreground or muted. Decorative unless the caller labels it.
 */
function StatusDot({ tone = 'neutral', live = false, className, ...props }: StatusDotProps) {
  return (
    <span
      aria-hidden={props['aria-label'] === undefined ? true : undefined}
      className={cn(
        'size-(--status-dot-size) shrink-0',
        TONE_CLASS[tone],
        live && 'status-breathe',
        className,
      )}
      data-live={live ? '' : undefined}
      data-slot='status-dot'
      data-tone={tone}
      {...props}
    />
  )
}

export { StatusDot }
