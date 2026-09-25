import { Button } from '@workspace/ui/components/button'
import { useState, type KeyboardEvent } from 'react'

import { recorderLabel } from '@/features/settings/utils/recording'
import { recordedStroke, recordingControl } from '@workspace/client-core/settings/recording'
import type { PlatformKeyBinding } from '@/keymap/types'
import {
  isBindableChord,
  isChordPrefix,
  MAX_CHORD_STROKES,
  normalizedChord,
} from '@workspace/client-core/commands/chord'

export function ChordRecorder({
  bindings = [],
  conflictCount,
  disabled,
  id,
  onChange,
  value,
}: {
  bindings?: readonly PlatformKeyBinding[]
  conflictCount: number
  disabled?: boolean
  id: string
  onChange: (next: string) => void
  value: string
}) {
  const [strokes, setStrokes] = useState<readonly string[] | null>(null)
  const recording = strokes !== null
  const label = recorderLabel(strokes, value)

  function commit(keys: string) {
    onChange(keys)
    setStrokes(null)
  }

  function record(event: KeyboardEvent<HTMLButtonElement>) {
    if (strokes === null || event.nativeEvent.isComposing || event.keyCode === 229) return

    // Recording owns the keyboard before the app's bubble listener sees it.
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    const control = recordingControl(event)
    if (control === 'cancel') return setStrokes(null)
    if (control === 'remove' && strokes.length > 0) return setStrokes(strokes.slice(0, -1))
    if (control === 'commit' && strokes.length > 0) return commit(strokes.join(' '))

    const stroke = recordedStroke(event)
    if (!stroke) return
    const next = [...strokes, stroke]
    const keys = next.join(' ')
    if (!isBindableChord(keys)) return

    const normalized = normalizedChord(keys)
    if (next.length < MAX_CHORD_STROKES && isChordPrefix(normalized, bindings)) {
      setStrokes([normalized])
      return
    }

    commit(normalized)
  }

  return (
    <div className='flex min-w-0 flex-col items-end gap-1'>
      <div className='flex min-w-0 items-center gap-1 @max-3xl/settings:w-full'>
        <Button
          aria-label={recording ? `Recording a shortcut for ${id}` : `Record a shortcut for ${id}`}
          className='font-meta w-52 justify-center text-xs whitespace-nowrap @max-3xl/settings:w-full @max-3xl/settings:min-w-0'
          disabled={disabled}
          id={id}
          onBlur={() => setStrokes(null)}
          onClick={() => setStrokes([])}
          onKeyDown={record}
          title={label}
          variant={recording ? 'secondary' : 'outline'}
        >
          <span className='truncate'>{label}</span>
        </Button>
      </div>
      {conflictCount > 0 ? (
        <span className='text-warning text-xs tabular-nums'>
          {conflictCount} other {conflictCount === 1 ? 'command uses' : 'commands use'} this
        </span>
      ) : null}
    </div>
  )
}
