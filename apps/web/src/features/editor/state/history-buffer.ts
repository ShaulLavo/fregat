import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { createEditorTextBuffer, type EditorTextBuffer } from '@singapore-editor/core/document'

// The retention budget is a setting; every buffer that can become a live document carries it.
export function createHistoryBuffer(text: string): EditorTextBuffer {
  return createEditorTextBuffer(text, {
    retainedHistoryStates: readSettingsMirror()['editor.history.retainedStates'],
  })
}
