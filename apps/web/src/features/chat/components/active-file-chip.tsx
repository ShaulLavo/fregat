import { FileIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

/** The active editor file riding with the next message; removing it sends without it. */
export function ActiveFileChip({
  disabled,
  path,
  onRemove,
}: {
  readonly disabled: boolean
  readonly path: string
  readonly onRemove: () => void
}) {
  return (
    <div className='flex min-w-0 px-(--density-control-padding-x) pb-(--density-section-gap)'>
      <span className='inline-flex min-w-0 items-center gap-0.5' title={path}>
        <span className='bg-muted text-foreground inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-xs leading-tight select-none'>
          <FileIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
          <span className='min-w-0 truncate'>{path}</span>
          <span className='text-muted-foreground shrink-0 font-sans'>Active file</span>
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`Remove active file ${path}`}
                className='text-muted-foreground'
                disabled={disabled}
                focusableWhenDisabled
                size='icon-xs'
                type='button'
                variant='ghost'
                onClick={onRemove}
              >
                <XIcon className='size-(--icon-size-sm)' />
              </Button>
            }
          />
          <TooltipContent>Send without the active file</TooltipContent>
        </Tooltip>
      </span>
    </div>
  )
}
