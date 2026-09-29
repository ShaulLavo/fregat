import type { EditorOptions } from '@singapore-editor/core/editor'
import {
  editorKeymapLayersForCommandPacks,
  type EditorCommandPack,
  type EditorKeymapOptions,
} from '@singapore-editor/core/keymap'
import type { EditorCursorLineHighlightOptions } from '@singapore-editor/core/rendering'

// Every nested field is present, so a host extends `keymap.layers` or one highlight part in place.
export type DiffEditorOptions = Required<
  Pick<EditorOptions, 'detectIndentation' | 'documentMode' | 'editability' | 'folding'>
> & {
  readonly cursorLineHighlight: Required<EditorCursorLineHighlightOptions>
  readonly keymap: DiffKeymap
}

type DiffKeymap = Readonly<Required<Pick<EditorKeymapOptions, 'defaultBindings' | 'layers'>>>

// Read-only already refuses every editing key, and `folding: false` leaves fold keys nothing to do.
const DIFF_COMMAND_PACKS = [
  'navigation',
  'selection',
  'find',
] as const satisfies readonly EditorCommandPack[]

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
    keymap: (diffKeymap ??= Object.freeze({
      defaultBindings: false,
      layers: editorKeymapLayersForCommandPacks(DIFF_COMMAND_PACKS),
    })),
  }
}
