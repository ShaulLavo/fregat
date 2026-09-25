import { CheckIcon, TerminalIcon } from '@phosphor-icons/react'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

export function SshHostOption({
  target,
  label = target,
  selected,
  offline = false,
  onSelect,
  rowProps,
}: {
  readonly rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  readonly target: string
  readonly label?: string
  readonly selected: boolean
  readonly offline?: boolean
  readonly onSelect: (target: string) => void
}) {
  return (
    <ListRow
      {...rowProps}
      as='button'
      role='option'
      className='w-full gap-2'
      title={label === target ? target : `${label} (${target})`}
      onClick={(event) => {
        rowProps.onClick(event)
        onSelect(target)
      }}
    >
      <TerminalIcon className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
      <span className='flex min-w-0 flex-1 items-center gap-2 text-left'>
        <span className='font-meta block truncate'>{label}</span>
        {label !== target ? (
          <span className='text-muted-foreground text-2xs font-meta truncate'>{target}</span>
        ) : null}
      </span>
      {offline ? <span className='text-muted-foreground text-xs'>Offline</span> : null}
      {selected ? <CheckIcon className='size-(--icon-size-sm) shrink-0' /> : null}
    </ListRow>
  )
}
