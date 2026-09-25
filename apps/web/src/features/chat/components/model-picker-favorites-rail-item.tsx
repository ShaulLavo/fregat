import { StarIcon } from '@phosphor-icons/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Button } from '@workspace/ui/components/button'

export function ModelPickerFavoritesRailItem({
  active,
  onSelect,
}: {
  readonly active: boolean
  readonly onSelect: () => void
}) {
  return (
    <div className='relative w-full'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='Favorites'
              aria-pressed={active}
              className='aspect-square h-auto w-full'
              size='icon'
              type='button'
              variant='ghost'
              onClick={onSelect}
            >
              <StarIcon className='size-(--icon-size)' weight={active ? 'fill' : 'regular'} />
            </Button>
          }
        />
        <TooltipContent align='center'>Favorites</TooltipContent>
      </Tooltip>
      {active ? (
        <span
          aria-hidden='true'
          className='bg-primary pointer-events-none absolute top-1/2 -right-1 h-5 w-0.75 -translate-y-1/2 rounded-l-full'
        />
      ) : null}
    </div>
  )
}
