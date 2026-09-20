import { PaperclipIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useRef, type ChangeEvent } from 'react'

import { CHAT_IMAGE_MIME_ALLOWLIST } from '@/features/chat/utils/input-attachment-limits'

// Filters the OS picker to what the composer can actually stage. It is a hint,
// not a gate: every picked file still goes through the same classifier as a
// paste or a drop.
const FILE_INPUT_ACCEPT = CHAT_IMAGE_MIME_ALLOWLIST.join(',')

/**
 * Opens the OS file picker for image attachments. No primitive wraps a native
 * file input, so the raw input stays here, visually hidden, and the visible
 * affordance is a normal ghost button that clicks it.
 */
export function ChatInputAttachButton({
  disabled,
  onSelectFiles,
}: {
  readonly disabled: boolean
  readonly onSelectFiles: (files: readonly File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Clearing the value is what lets the same file be picked twice in a row:
    // without it the second pick is not a change and fires no event.
    event.target.value = ''
    if (files.length === 0) return

    onSelectFiles(files)
  }

  return (
    <>
      <input
        accept={FILE_INPUT_ACCEPT}
        // Hidden from assistive tech as well: the button below is the labelled
        // control, and it is the only thing that ever focuses or clicks this.
        aria-hidden='true'
        className='sr-only'
        disabled={disabled}
        multiple
        ref={inputRef}
        tabIndex={-1}
        type='file'
        onChange={handleChange}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='Attach images'
              className='text-muted-foreground'
              disabled={disabled}
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={() => inputRef.current?.click()}
            />
          }
        >
          <PaperclipIcon className='size-(--icon-size-sm)' />
        </TooltipTrigger>
        <TooltipContent>Attach images</TooltipContent>
      </Tooltip>
    </>
  )
}
