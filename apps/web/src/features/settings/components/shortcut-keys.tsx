import { Kbd } from '@workspace/ui/components/kbd'
import { cn } from '@workspace/ui/lib/utils'
import { chordStrokes, type PlatformName } from '@workspace/client-core/commands/chord'

import { formatChord } from '@/keymap/utils/format-keys'

/** The first chord as one key chip per stroke, then how many more the command has. */
export function ShortcutKeys({
  keys,
  platform,
  size = 'sm',
  struck = false,
}: {
  keys: readonly string[]
  platform: PlatformName
  size?: 'sm' | 'md'
  /** Another command took this chord; it stays visible so the clash can be read. */
  struck?: boolean
}) {
  const [first] = keys
  if (first === undefined) return null

  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-2', struck && 'text-muted-foreground')}
    >
      <span className='inline-flex items-center gap-1'>
        {chordStrokes(first).map((stroke, index) => (
          <Kbd className={cn(struck && 'line-through')} key={`${index}:${stroke}`} size={size}>
            {formatChord(stroke, platform)}
          </Kbd>
        ))}
      </span>
      {keys.length > 1 ? (
        <span className='text-muted-foreground text-2xs font-mono tabular-nums'>
          +{keys.length - 1}
        </span>
      ) : null}
    </span>
  )
}
