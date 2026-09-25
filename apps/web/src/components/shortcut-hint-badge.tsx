import { cn } from '@workspace/ui/lib/utils'

import { useShortcutHint } from '@/keymap/hooks/use-shortcut-hint'
import type { PlatformCommandId } from '@/keymap/types'

/**
 * The key that selects this target, shown while its modifiers are held. It overlays the
 * target without moving layout and never takes a click; the caller places it.
 */
export function ShortcutHintBadge({
  className,
  command,
}: {
  readonly className?: string
  readonly command: PlatformCommandId | null
}) {
  const label = useShortcutHint(command)
  if (!label) return null

  return (
    <span
      aria-hidden='true'
      className={cn(
        'bg-popover-solid text-foreground ring-foreground/10 pointer-events-none absolute z-10 inline-flex h-4 min-w-4 items-center justify-center rounded-md px-1 font-mono text-3xs font-medium tabular-nums ring-1',
        className,
      )}
      data-shortcut-hint={label}
    >
      {label}
    </span>
  )
}
