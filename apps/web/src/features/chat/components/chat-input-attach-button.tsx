import { CameraIcon, DesktopTowerIcon, PaperclipIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useRef, useState, type ChangeEvent } from 'react'

import { DeferredFilePickerDialog } from '@/components/deferred-file-picker-dialog'
import { useMachineAttachOffer } from '@/features/chat/hooks/use-machine-attach-offer'
import { useScreenshotCapture } from '@/features/chat/hooks/use-screenshot-capture'

/** Files on the machine the draft runs on, chosen in the in-app picker and attached by path. */
export type MachineFilesAttach = {
  /** The folder the picker opens in: the project. */
  readonly startPath: string | null
  /** How many more files the message holds. */
  readonly limit: number
  readonly onAttach: (paths: readonly string[]) => void
}

/**
 * Attach files or a screenshot. No primitive wraps a native file input, so the
 * raw input stays here, visually hidden, and the visible control clicks it.
 * Where the browser can neither capture the screen nor reach another machine's
 * files, the control is the plain button.
 */
export function ChatInputAttachButton({
  captureScope,
  disabled,
  machineFiles = null,
  onSelectFiles,
}: {
  /** Keys the capture mutation: one draft or one question. */
  readonly captureScope: string
  readonly disabled: boolean
  readonly machineFiles?: MachineFilesAttach | null
  readonly onSelectFiles: (files: readonly File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const screenshot = useScreenshotCapture(captureScope, onSelectFiles)
  const offer = useMachineAttachOffer(machineFiles !== null)
  const machine = machineFiles && offer ? { ...machineFiles, label: offer.label } : null
  const [choosingOnMachine, setChoosingOnMachine] = useState(false)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Clearing the value is what lets the same file be picked twice in a row:
    // without it the second pick is not a change and fires no event.
    event.target.value = ''
    if (files.length === 0) return

    onSelectFiles(files)
  }

  const menu = screenshot.supported || machine !== null
  const triggerProps = {
    'aria-label': menu ? 'Attach' : 'Attach files',
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
      {menu ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={<DropdownMenuTrigger render={<Button {...triggerProps}>{icon}</Button>} />}
            />
            <TooltipContent>Attach</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align='start' className='w-max max-w-72' side='top'>
            <DropdownMenuItem onClick={() => inputRef.current?.click()}>
              <PaperclipIcon aria-hidden='true' className='size-(--icon-size-sm)' />
              {machine ? 'From this device…' : 'Attach files…'}
            </DropdownMenuItem>
            {machine ? (
              <DropdownMenuItem
                disabled={machine.limit === 0}
                onClick={() => setChoosingOnMachine(true)}
              >
                <DesktopTowerIcon aria-hidden='true' className='size-(--icon-size-sm)' />
                {`From ${machine.label ?? 'the project’s machine'}…`}
              </DropdownMenuItem>
            ) : null}
            {screenshot.supported ? (
              <DropdownMenuItem onClick={screenshot.capture}>
                <CameraIcon aria-hidden='true' className='size-(--icon-size-sm)' />
                Screenshot…
              </DropdownMenuItem>
            ) : null}
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
      {machine && choosingOnMachine ? (
        <DeferredFilePickerDialog
          files={{
            limit: machine.limit,
            startPath: machine.startPath,
            onPick: (entries) => machine.onAttach(entries.map((entry) => entry.path)),
          }}
          onOpenChange={setChoosingOnMachine}
          open
        />
      ) : null}
    </>
  )
}
