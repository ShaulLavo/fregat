import { useCallback, useSyncExternalStore } from 'react'
import { ArrowArcLeftIcon, ArrowArcRightIcon } from '@phosphor-icons/react'
import type { EditorTextBuffer, EditorViewSession } from '@singapore-editor/core/document'
import { Button } from '@workspace/ui/components/button'
import { Kbd } from '@workspace/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useCommandShortcut } from '@/keymap/hooks/use-command-shortcut'

export function CsvHistoryAction({
  buffer,
  view,
  editable,
  action,
}: {
  readonly buffer: EditorTextBuffer
  readonly view: EditorViewSession
  readonly editable: boolean
  readonly action: 'undo' | 'redo'
}) {
  // useSyncExternalStore keeps the live buffer subscription stable.
  const subscribe = useCallback((listener: () => void) => buffer.subscribe(listener), [buffer])
  // useSyncExternalStore reads a primitive so history availability also keys compiler output.
  const read = useCallback(
    () => (action === 'undo' ? buffer.canUndo() : buffer.canRedo()),
    [action, buffer],
  )
  const available = useSyncExternalStore(subscribe, read)
  const shortcut = useCommandShortcut(action === 'undo' ? 'editor.undo' : 'editor.redo')
  const label = action === 'undo' ? 'Undo' : 'Redo'
  const Icon = action === 'undo' ? ArrowArcLeftIcon : ArrowArcRightIcon
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={label}
            disabled={!editable || !available}
            focusableWhenDisabled
            onClick={() => {
              if (action === 'undo') buffer.undo(view)
              else buffer.redo(view)
            }}
          >
            <Icon className='size-(--icon-size)' />
          </Button>
        }
      />
      <TooltipContent>
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}
