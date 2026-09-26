import { isBindableChord, type PlatformName } from '@workspace/client-core/commands/chord'
import { recordedStroke } from '@workspace/client-core/settings/recording'

type RecordingKey = {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export type RecordingStep =
  | { readonly kind: 'record'; readonly strokes: readonly string[] }
  | { readonly kind: 'save' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'close' }
  | { readonly kind: 'ignore' }

/**
 * One key in the recorder, as VS Code handles it: Enter saves, Escape clears a recorded chord and
 * then closes, every other key records, Backspace included. A second stroke follows only a first
 * with Ctrl or Cmd, and a third starts over.
 */
export function recordingStep(
  strokes: readonly string[],
  event: RecordingKey,
  platform: PlatformName,
): RecordingStep {
  const bare = !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
  if (bare && event.key === 'Enter')
    return strokes.length > 0 ? { kind: 'save' } : { kind: 'ignore' }
  if (bare && event.key === 'Escape')
    return strokes.length > 0 ? { kind: 'clear' } : { kind: 'close' }

  const stroke = recordedStroke(event, platform)
  if (!stroke) return { kind: 'ignore' }

  const next = strokes.length === 1 ? [...strokes, stroke] : [stroke]
  if (isBindableChord(next.join(' '))) return { kind: 'record', strokes: next }
  if (isBindableChord(stroke)) return { kind: 'record', strokes: [stroke] }

  return { kind: 'ignore' }
}
