import { Kbd } from '@workspace/ui/components/kbd'
import { cn } from '@workspace/ui/lib/utils'
import { chordStrokes, type PlatformName } from '@workspace/client-core/commands/chord'

import { formatChord } from '@/keymap/utils/format-keys'

/** One chord as one key chip per stroke. */
export function ShortcutKeys({
  keys,
  platform,
  size = 'sm',
  struck = false,
}: {
  keys: string
  platform: PlatformName
  size?: 'sm' | 'md'
  /** Another command took this chord; it stays visible so the clash can be read. */
  struck?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', struck && 'text-muted-foreground')}>
      {chordStrokes(keys).map((stroke, index) => (
        <Kbd className={cn(struck && 'line-through')} key={`${index}:${stroke}`} size={size}>
          {formatChord(stroke, platform)}
        </Kbd>
      ))}
    </span>
  )
}
