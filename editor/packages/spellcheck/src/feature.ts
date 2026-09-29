import { createEditorCapabilityToken } from '@singapore-editor/core/extensions'

export type SpellIssue = {
  readonly start: number
  readonly end: number
  readonly word: string
}

/** What a host reaches through `editor.getFeature(EDITOR_SPELLCHECK_FEATURE)`. */
export type EditorSpellcheckFeature = {
  /** The marked word at `offset`, edges included; only words on or near the screen are marked. */
  issueAt(offset: number): SpellIssue | null
  /** Replacements for the marked word at `offset`, best first; empty when nothing is marked there. */
  suggestions(offset: number, limit?: number): Promise<readonly string[]>
  /** Replaces the marked word at `offset` as one undoable edit. False when nothing is marked there. */
  replace(offset: number, word: string): boolean
  /** Words never marked, in every editor sharing this editor's spellcheck service. */
  setAcceptedWords(words: readonly string[]): void
}

export const EDITOR_SPELLCHECK_FEATURE_ID = 'editor.spellcheck'

export const EDITOR_SPELLCHECK_FEATURE = createEditorCapabilityToken<EditorSpellcheckFeature>(
  EDITOR_SPELLCHECK_FEATURE_ID,
)
