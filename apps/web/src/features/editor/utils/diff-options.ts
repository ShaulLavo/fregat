import type { EditorCursorLineHighlightOptions } from '@singapore-editor/core/rendering'
import type { EditorKeymapOptions } from '@singapore-editor/core/keymap'

/**
 * The editor options a diff cannot be built without. Each one is load-bearing rather than taste —
 * omitting it does not degrade the diff, it breaks it — so they live together, named, instead of
 * being retyped at two mount sites.
 */

/**
 * The buffer is an interleaved projection full of placeholder rows and `Show N unmodified lines`
 * separators; guessing indentation from it would flip the width per file *and* per expansion
 * toggle. The diff takes `editor.tabSize` as it is.
 */
export const DIFF_DETECT_INDENTATION = false

/**
 * `undefined` means *default* here, and the default is `rowBackground: true` — a cursor line
 * painted on top of the diff's own row tint, which the old `DiffView` never had because it had no
 * cursor at all.
 */
export const DIFF_CURSOR_LINE_HIGHLIGHT: EditorCursorLineHighlightOptions = {
  gutterBackground: false,
  gutterNumber: false,
  rowBackground: false,
}

/** A real `Editor` otherwise brings find and the edit commands into a read-only diff. */
export const DIFF_KEYMAP: EditorKeymapOptions = {
  enabled: false,
}
