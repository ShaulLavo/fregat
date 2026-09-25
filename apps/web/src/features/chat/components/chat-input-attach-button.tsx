import { CameraIcon, PaperclipIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useRef, type ChangeEvent } from 'react'

import { useScreenshotCapture } from '@/features/chat/hooks/use-screenshot-capture'

/**
 * Attach files or a screenshot. No primitive wraps a native file input, so the
 * raw input stays here, visually hidden, and the visible control clicks it.
 * Where the browser cannot capture the screen, the control is the plain button.
 */
export function ChatInputAttachButton({
  captureScope,
  disabled,
  onSelectFiles,
}: {
  /** Keys the capture mutation: one draft or one question. */
  readonly captureScope: string
  readonly disabled: boolean
  readonly onSelectFiles: (files: readonly File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const screenshot = useScreenshotCapture(captureScope, onSelectFiles)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Clearing the value is what lets the same file be picked twice in a row:
    // without it the second pick is not a change and fires no event.
    event.target.value = ''
    if (files.length === 0) return

    onSelectFiles(files)
  }

  const triggerProps = {
    'aria-label': screenshot.supported ? 'Attach' : 'Attach files',
    className: 'text-muted-foreground',
    disabled: disabled || screenshot.capturing,
    focusableWhenDisabled: true,
    size: 'icon-sm',
    type: 'button',
    variant: 'ghost',
  } as const
  const icon = screenshot.capturing ? (
    <Spinner />
  ) : (
    <PaperclipIcon className='size-(--icon-size-sm)' />
  )

  return (
    <>
      <input
        // Hidden from assistive tech as well: the visible control is the labelled
        // one, and it is the only thing that ever focuses or clicks this.
        aria-hidden='true'
        className='sr-only'
        disabled={disabled}
        multiple
        ref={inputRef}
        tabIndex={-1}
        type='file'
        onChange={handleChange}
      />
      {screenshot.supported ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={<DropdownMenuTrigger render={<Button {...triggerProps}>{icon}</Button>} />}
            />
            <TooltipContent>Attach</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align='start' side='top'>
            <DropdownMenuItem onClick={() => inputRef.current?.click()}>
              <PaperclipIcon aria-hidden='true' className='size-(--icon-size-sm)' />
              Attach files…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={screenshot.capture}>
              <CameraIcon aria-hidden='true' className='size-(--icon-size-sm)' />
              Screenshot…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button {...triggerProps} onClick={() => inputRef.current?.click()}>
                {icon}
              </Button>
            }
          />
          <TooltipContent>Attach files</TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
