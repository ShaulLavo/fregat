import { detectPlatform, isModifierKey, normalizeKeyName } from '@tanstack/hotkeys'

type RecordingKeyEvent = {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export function recordingControl(event: RecordingKeyEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.key === 'Escape') return 'cancel'
  if (event.key === 'Backspace') return 'remove'
  if (event.key === 'Enter') return 'commit'
  return null
}

export function recordedStroke(
  event: RecordingKeyEvent,
  platform: ReturnType<typeof detectPlatform> = detectPlatform(),
): string | null {
  const key = normalizeKeyName(event.key)
  if (isModifierKey(key)) return null
  const parts: string[] = []
  // Mod is the platform's primary modifier (Cmd on macOS, Ctrl elsewhere), which keeps a
  // recording portable; the other key records under its own name.
  const mac = platform === 'mac'
  if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod')
  if (mac ? event.ctrlKey : event.metaKey) parts.push(mac ? 'Control' : 'Meta')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}
