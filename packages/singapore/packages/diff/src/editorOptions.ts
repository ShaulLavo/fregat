import type { EditorOptions } from '@singapore-editor/core/editor'
import { readonlyDiffPack, type EditorKeymapOptions } from '@singapore-editor/core/keymap'
import type { EditorCursorLineHighlightOptions } from '@singapore-editor/core/rendering'

// Every nested field is present, so a host extends `keymap.packs` or one highlight part in place.
export type DiffEditorOptions = Required<
  Pick<
    EditorOptions,
    'detectIndentation' | 'documentMode' | 'editability' | 'folding' | 'keymapContext'
  >
> & {
  readonly cursorLineHighlight: Required<EditorCursorLineHighlightOptions>
  readonly keymap: DiffKeymap
}

type DiffKeymap = Readonly<Required<Pick<EditorKeymapOptions, 'packs' | 'bindings'>>>

// One object for every call: a React host compares `keymap` by identity and re-applies a new one.
let diffKeymap: DiffKeymap | undefined

/**
 * The options an editor holding a `mode: 'document'` diff needs; an overlay diff keeps its host's
 * editable options. Spread them and add the host's own, such as plugins, typography and theme.
 */
export function createDiffEditorOptions(): DiffEditorOptions {
  return {
    cursorLineHighlight: { gutterBackground: false, gutterNumber: false, rowBackground: false },
    // The buffer interleaves both sides, so a guess would change the width per file and per toggle.
    detectIndentation: false,
    documentMode: 'static',
    editability: 'readonly',
    // A fold would hide a deletion and its addition, and misalign a split.
    folding: false,
    keymapContext: { mode: 'diff' },
    keymap: (diffKeymap ??= Object.freeze({
      packs: [readonlyDiffPack],
      bindings: [],
    })),
  }
}
