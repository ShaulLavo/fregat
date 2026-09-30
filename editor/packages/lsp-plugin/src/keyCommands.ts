import type { EditorCommandId } from '@singapore-editor/core/editor'

export type CompletionKeyCommand =
  | 'trigger'
  | 'next'
  | 'previous'
  | 'nextPage'
  | 'previousPage'
  | 'accept'
  | 'hide'

export type SignatureHelpKeyCommand = 'close' | 'next' | 'previous'

/** The editor commands the keymap binds to the completion list; see the core's suggest pack. */
export const COMPLETION_KEY_COMMANDS = {
  trigger: 'editor.action.triggerSuggest',
  next: 'selectNextSuggestion',
  previous: 'selectPrevSuggestion',
  nextPage: 'selectNextPageSuggestion',
  previousPage: 'selectPrevPageSuggestion',
  accept: 'acceptSelectedSuggestion',
  hide: 'hideSuggestWidget',
} as const satisfies Record<CompletionKeyCommand, EditorCommandId>

/** Kept apart from the controller, which loads on the first `(`, so naming them costs nothing. */
export const SIGNATURE_HELP_KEY_COMMANDS = {
  close: 'closeParameterHints',
  next: 'showNextParameterHint',
  previous: 'showPrevParameterHint',
} as const satisfies Record<SignatureHelpKeyCommand, EditorCommandId>
