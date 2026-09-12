import { CheckIcon, TerminalIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

export function SshHostOption({
  target,
  label = target,
  selected,
  offline = false,
  onSelect,
}: {
  readonly target: string
  readonly label?: string
  readonly selected: boolean
  readonly offline?: boolean
  readonly onSelect: (target: string) => void
}) {
  return (
    <Button
      type='button'
      variant='ghost'
      className='h-auto min-h-8 w-full justify-start gap-2'
      aria-pressed={selected}
      onClick={() => onSelect(target)}
    >
      <TerminalIcon className='text-muted-foreground size-4 shrink-0' />
      <span className='min-w-0 flex-1 text-left'>
        <span className='block truncate font-mono'>{label}</span>
        {label !== target ? (
          <span className='text-muted-foreground block truncate font-mono text-xs'>{target}</span>
        ) : null}
      </span>
      {offline ? <span className='text-muted-foreground text-xs'>Offline</span> : null}
      {selected ? <CheckIcon className='size-4 shrink-0' /> : null}
    </Button>
  )
}
