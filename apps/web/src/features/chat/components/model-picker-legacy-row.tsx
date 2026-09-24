import { CaretRightIcon } from '@phosphor-icons/react'
import { CommandItem } from '@workspace/ui/components/command'
import { stackedListRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { cn } from '@workspace/ui/lib/utils'

/**
 * Folds a provider's retired models under one row after its current ones, as
 * T3's picker does. Selecting it toggles the section; it never picks a model.
 */
export function ModelPickerLegacyRow({
  count,
  expanded,
  onToggle,
}: {
  readonly count: number
  readonly expanded: boolean
  readonly onToggle: () => void
}) {
  return (
    <CommandItem
      aria-expanded={expanded}
      className={cn(stackedListRowClassName, 'cursor-pointer')}
      value='legacy-models'
      onSelect={onToggle}
    >
      <span className='min-w-0 flex-1 text-left'>
        <span className='block text-xs leading-snug font-medium'>Legacy models</span>
        <span className='text-muted-foreground mt-(--density-gap-tight) block text-xs leading-snug font-normal tabular-nums'>
          {count === 1 ? '1 model' : `${count} models`}
        </span>
      </span>
      <CaretRightIcon
        aria-hidden='true'
        className={cn(
          'text-muted-foreground size-(--icon-size-sm) shrink-0 transition-transform',
          expanded && 'rotate-90',
        )}
      />
    </CommandItem>
  )
}
