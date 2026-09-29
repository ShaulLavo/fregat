import { useEffect, useLayoutEffect, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import { HotkeyRecorder } from '@fregat/hotkeys'
import { useDefaultHotkeysOptions } from './HotkeysProvider'
import type { Hotkey, HotkeyRecorderOptions } from '@fregat/hotkeys'

export interface ReactHotkeyRecorder {
  /** Whether recording is currently active */
  isRecording: boolean
  /** The currently recorded hotkey (for live preview) */
  recordedHotkey: Hotkey | null
  /** Start recording a new hotkey */
  startRecording: () => void
  /** Stop recording (same as cancel) */
  stopRecording: () => void
  /** Cancel recording without saving */
  cancelRecording: () => void
}

/**
 * React hook for recording keyboard shortcuts.
 *
 * This hook provides a thin wrapper around the framework-agnostic `HotkeyRecorder`
 * class, managing all the complexity of capturing keyboard events, converting them
 * to hotkey strings, and handling edge cases like Escape to cancel or Backspace/Delete
 * to clear.
 *
 * @param options - Configuration options for the recorder
 * @returns An object with recording state and control functions
 *
 * @example
 * ```tsx
 * function ShortcutSettings() {
 *   const [shortcut, setShortcut] = useState<Hotkey>('Mod+S')
 *
 *   const recorder = useHotkeyRecorder({
 *     onRecord: (hotkey) => {
 *       setShortcut(hotkey)
 *     },
 *     onCancel: () => {
 *       console.log('Recording cancelled')
 *     },
 *   })
 *
 *   return (
 *     <div>
 *       <button onClick={recorder.startRecording}>
 *         {recorder.isRecording ? 'Recording...' : 'Edit Shortcut'}
 *       </button>
 *       {recorder.recordedHotkey && (
 *         <div>Recording: {recorder.recordedHotkey}</div>
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */
export function useHotkeyRecorder(options: HotkeyRecorderOptions): ReactHotkeyRecorder {
  const mergedOptions = {
    ...useDefaultHotkeysOptions().hotkeyRecorder,
    ...options,
  }

  const [recorder] = useState(() => new HotkeyRecorder(mergedOptions))

  // Callbacks in the options must see the latest render's values.
  useLayoutEffect(() => {
    recorder.setOptions(mergedOptions)
  })

  const isRecording = useSelector(recorder.store, (state) => state.isRecording)
  const recordedHotkey = useSelector(recorder.store, (state) => state.recordedHotkey)

  useEffect(() => () => recorder.destroy(), [recorder])

  return {
    isRecording,
    recordedHotkey,
    startRecording: () => recorder.start(),
    stopRecording: () => recorder.stop(),
    cancelRecording: () => recorder.cancel(),
  }
}
