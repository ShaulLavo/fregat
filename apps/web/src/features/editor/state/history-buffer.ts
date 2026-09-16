import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'
import { createEditorTextBuffer, type EditorTextBuffer } from '@singapore-editor/core'

// The retention budget is a setting; every buffer that can become a live document carries it.
export function createHistoryBuffer(text: string): EditorTextBuffer {
  return createEditorTextBuffer(text, {
    retainedHistoryStates: readSettingsMirror()['editor.history.retainedStates'],
  })
}
