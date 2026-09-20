import { GlobeIcon, TerminalIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export function MachineConnectionOption({
  kind,
  selected,
  onSelect,
}: {
  readonly kind: 'origin' | 'ssh'
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const Icon = kind === 'ssh' ? TerminalIcon : GlobeIcon
  return (
    <Button
      type='button'
      variant='outline'
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'h-auto min-h-24 items-start justify-start gap-3 p-4 text-left whitespace-normal',
        selected && 'border-primary/50 bg-accent',
      )}
    >
      <span className='border-border text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border'>
        <Icon className='size-(--icon-size)' />
      </span>
      <span className='min-w-0'>
        <span className='text-foreground block text-sm font-medium'>
          {kind === 'ssh' ? 'SSH' : 'Remote URL'}
        </span>
        <span className='text-muted-foreground mt-1 block text-xs leading-relaxed font-normal'>
          {kind === 'ssh'
            ? 'Start a server using your SSH config and keys.'
            : 'Connect to a running Platform server.'}
        </span>
      </span>
    </Button>
  )
}
