import { CheckIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import type { ReactNode } from 'react'

export function WallpaperChoice({
  label,
  title,
  ariaLabel,
  selected,
  disabled,
  onSelect,
  children,
}: {
  readonly label: string
  readonly title: string
  readonly ariaLabel: string
  readonly selected: boolean
  readonly disabled: boolean
  readonly onSelect: () => void
  readonly children: ReactNode
}) {
  return (
    <Button
      variant='outline'
      className='aria-pressed:border-primary aria-pressed:outline-primary relative h-auto w-full min-w-0 flex-col items-stretch gap-1 p-1 aria-pressed:outline-2 aria-pressed:-outline-offset-2 aria-pressed:outline-solid'
      aria-label={ariaLabel}
      aria-pressed={selected}
      title={title}
      disabled={disabled}
      onClick={onSelect}
    >
      {children}
      <span className='truncate px-1 text-left text-xs'>{label}</span>
      {selected ? (
        <span className='bg-primary text-primary-foreground absolute top-2 right-2 flex size-4 items-center justify-center rounded-full'>
          <CheckIcon aria-hidden='true' className='size-(--icon-size-sm)' weight='bold' />
        </span>
      ) : null}
    </Button>
  )
}
