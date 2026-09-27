import { CaretRightIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { DropdownMenuItem } from '@workspace/ui/components/dropdown-menu'
import { cn } from '@workspace/ui/lib/utils'

/** One setting in the setup sheet: what it is, its value in full, and a way into its choices. */
export function DraftSetupRow({
  detail,
  disabled,
  icon,
  label,
  mono,
  value,
  onOpen,
}: {
  /** A second value line, such as the branch a checkout is on. */
  readonly detail?: string
  readonly disabled?: boolean
  readonly icon: ReactNode
  readonly label: string
  /** The value is a name from the repository (a branch), set in the code face. */
  readonly mono?: boolean
  readonly value: string
  readonly onOpen: () => void
}) {
  return (
    <DropdownMenuItem
      aria-haspopup='menu'
      className='gap-3 py-(--density-row-padding-y)'
      closeOnClick={false}
      disabled={disabled}
      onClick={onOpen}
    >
      <span className='text-muted-foreground flex w-(--icon-size) shrink-0 justify-center'>
        {icon}
      </span>
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='text-muted-foreground text-xs'>{label}</span>
        <span className={cn('text-foreground text-sm wrap-anywhere', mono && 'font-mono text-xs')}>
          {value}
        </span>
        {detail ? (
          <span className='text-muted-foreground font-mono text-xs wrap-anywhere'>{detail}</span>
        ) : null}
      </span>
      <CaretRightIcon className='text-muted-foreground size-(--icon-size-sm)' />
    </DropdownMenuItem>
  )
}
