import { WarningIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from '@workspace/ui/components/popover'
import { normalizedChord, type PlatformName } from '@workspace/client-core/commands/chord'
import { useState, type KeyboardEvent } from 'react'

import { ShortcutKeys } from '@/features/settings/components/shortcut-keys'
import { noteKeyboardEvent, useKeyboardSeen } from '@/features/settings/state/keyboard-seen'
import { recordingStep } from '@/features/settings/utils/shortcut-recording'

export type RecorderPreview = {
  /** Commands the candidate chord would take, with where each uses it. */
  readonly takes: readonly { readonly title: string; readonly where: string }[]
  /** Set when the browser acts on the chord before the page sees it. */
  readonly kept: string | null
}

/**
 * Records a new shortcut as VS Code does: nothing is written until Save or Enter, and the commands
 * the chord would take are listed first. Cancel and Save stay for a keyboard with no Escape key.
 */
export function ShortcutRecorder({
  adding,
  anchor,
  onClose,
  onSave,
  platform,
  preview,
  title,
}: {
  adding: boolean
  anchor: HTMLElement
  onClose: () => void
  onSave: (keys: string) => void
  platform: PlatformName
  preview: (keys: string) => RecorderPreview
  title: string
}) {
  const [strokes, setStrokes] = useState<readonly string[]>([])
  const keyboardSeen = useKeyboardSeen()
  const keys = strokes.length > 0 ? normalizedChord(strokes.join(' '), platform) : null
  const checked = keys ? preview(keys) : null

  function record(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return
    noteKeyboardEvent(event.nativeEvent)
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return

    const step = recordingStep(strokes, event, platform)
    if (step.kind === 'record') setStrokes(step.strokes)
    if (step.kind === 'clear') setStrokes([])
    if (step.kind === 'close') onClose()
    if (step.kind === 'save' && keys) onSave(keys)
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open
    >
      <PopoverContent align='end' anchor={anchor} className='w-80'>
        <PopoverHeader>
          <PopoverTitle>{adding ? 'Add shortcut' : 'Change shortcut'}</PopoverTitle>
          <PopoverDescription className='truncate' title={title}>
            {title}
          </PopoverDescription>
        </PopoverHeader>
        <div
          aria-label={`Press the new shortcut for ${title}`}
          autoFocus
          className='bg-input/30 focus-ring flex h-12 items-center justify-center gap-2 rounded-md'
          onKeyDown={record}
          role='textbox'
          tabIndex={0}
        >
          {keys ? (
            <ShortcutKeys keys={[keys]} platform={platform} size='md' />
          ) : (
            <span className='text-muted-foreground text-xs'>
              {keyboardSeen ? 'Press the keys' : 'Waiting for a hardware keyboard'}
            </span>
          )}
        </div>
        {keyboardSeen ? null : (
          <p className='text-muted-foreground text-xs'>
            Recording needs a keyboard. Remove and Reset work from the row menu.
          </p>
        )}
        {checked && checked.takes.length > 0 ? (
          <div className='bg-warning/10 flex flex-col gap-1 rounded-md p-2'>
            <p className='text-warning flex items-center gap-1 text-xs font-medium'>
              <WarningIcon aria-hidden className='size-(--icon-size-sm)' />
              Used by {checked.takes.length} {checked.takes.length === 1 ? 'command' : 'commands'}
            </p>
            {checked.takes.map((take) => (
              <div
                className='flex min-w-0 items-center justify-between gap-2 text-xs'
                key={take.title}
              >
                <span className='truncate' title={take.title}>
                  {take.title}
                </span>
                <span className='text-muted-foreground text-2xs shrink-0'>{take.where}</span>
              </div>
            ))}
            <p className='text-muted-foreground text-2xs'>
              Saving takes the shortcut from {checked.takes.length === 1 ? 'it' : 'them'}.
            </p>
          </div>
        ) : null}
        {checked?.kept ? (
          <p className='bg-warning/10 text-warning flex items-center gap-1 rounded-md p-2 text-xs font-medium'>
            <WarningIcon aria-hidden className='size-(--icon-size-sm) shrink-0' />
            {checked.kept}
          </p>
        ) : null}
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground text-2xs'>Enter saves · Esc clears</span>
          <span className='flex gap-1'>
            <Button onClick={onClose} size='sm' variant='secondary'>
              Cancel
            </Button>
            <Button disabled={!keys} onClick={() => keys && onSave(keys)} size='sm'>
              Save
            </Button>
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
