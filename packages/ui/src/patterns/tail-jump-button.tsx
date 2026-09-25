import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react'
import type { ComponentProps, ReactNode } from 'react'

import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import type { TailEdge } from '@workspace/ui/patterns/tail-follow'

/**
 * The way back to a list's live edge: "Follow output", or how much arrived meanwhile ("23 new
 * lines"). A labelled button, so it needs no tooltip. The caller supplies the noun and may render
 * the count (a ticker, say).
 */
export function TailJumpButton({
  arrivals,
  className,
  count,
  edge,
  noun,
  onJump,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'onClick'> & {
  readonly arrivals: number
  readonly className?: string
  readonly count?: (value: number) => ReactNode
  readonly edge: TailEdge
  /** Singular; "line" reads "1 new line", "2 new lines". */
  readonly noun: string
  readonly onJump: () => void
}) {
  const Icon = edge === 'start' ? ArrowUpIcon : ArrowDownIcon
  return (
    <Button
      className={cn('bg-popover-solid rounded-full shadow-md', className)}
      data-slot='tail-jump-button'
      size='sm'
      type='button'
      variant='outline'
      {...props}
      onClick={onJump}
    >
      <Icon data-icon='inline-start' />
      {arrivals === 0 ? (
        'Follow output'
      ) : (
        <span className='tabular-nums'>
          {count ? count(arrivals) : arrivals} new {arrivals === 1 ? noun : `${noun}s`}
        </span>
      )}
    </Button>
  )
}
