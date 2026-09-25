import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { XIcon } from '@phosphor-icons/react'

import { Button } from '@workspace/ui/components/button'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { cn } from '@workspace/ui/lib/utils'

export function TabTrailingSlot({
  active,
  dirty,
  orientation,
  title,
  onClose,
}: {
  readonly active: boolean
  readonly dirty: boolean
  readonly orientation: 'horizontal' | 'vertical'
  readonly title: string
  readonly onClose: () => void
}) {
  return (
    <span
      className={cn(
        'relative grid size-5 shrink-0 place-items-center',
        orientation === 'vertical' && 'mt-1',
      )}
    >
      {/* Non-native button: the tab trigger around this slot is already a
          <button>, and nested <button> tags are invalid HTML. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Close ${title}`}
              className={cn('size-5', closeButtonVisibilityClassName({ active, dirty }))}
              draggable={false}
              nativeButton={false}
              render={<span />}
              size='icon-xs'
              tabIndex={-1}
              variant='ghost'
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <XIcon className='size-(--icon-size-sm)' />
            </Button>
          }
        />
        <TooltipContent>{`Close ${title}`}</TooltipContent>
      </Tooltip>
      {dirty ? (
        <StatusDot
          className={cn(
            'pointer-events-none absolute transition-opacity',
            'opacity-100 group-focus-within/proof-tab:opacity-0 group-hover/proof-tab:opacity-0',
          )}
          data-workbench-tab-dirty-indicator=''
          tone='warning'
        />
      ) : null}
    </span>
  )
}

function closeButtonVisibilityClassName({
  active,
  dirty,
}: {
  readonly active: boolean
  readonly dirty: boolean
}) {
  if (active && !dirty) return 'opacity-100'

  return 'pointer-events-none opacity-0 group-focus-within/proof-tab:pointer-events-auto group-focus-within/proof-tab:opacity-100 group-hover/proof-tab:pointer-events-auto group-hover/proof-tab:opacity-100'
}
