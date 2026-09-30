import type * as lsp from 'vscode-languageserver-protocol'

import type {
  LanguageServerCompletionApplication,
  LanguageServerCompletionEditFeature,
} from './completion'

/**
 * The character just typed, when the focused item asks to be accepted on it.
 *
 * Read off the focused item at the keystroke rather than kept in a set beside it: an item declares
 * two or three of these, so there is nothing to amortize, and a set that outlives the focus it was
 * built from is a set that accepts an item the user is no longer looking at.
 */
export function completionCommitCharacter(
  event: KeyboardEvent,
  item: lsp.CompletionItem | null,
  enabled: boolean,
): string | null {
  if (!enabled || !item) return null
  // A modifier makes the keystroke a command — `Ctrl+.` is a binding, not a typed period — and `key`
  // only names the character typed when it names a single character at all.
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key.length !== 1) return null

  return item.commitCharacters?.includes(event.key) === true ? event.key : null
}

/**
 * The edit feature with `character` folded into whatever acceptance goes through it.
 *
 * One acceptance is one call and so one undo entry, which is the whole reason the character travels
 * inside it: inserted afterwards it would be an entry of its own, and undoing the completion would
 * leave it stranded on the word it was meant to follow.
 */
export function completionCommitFeature(
  feature: LanguageServerCompletionEditFeature,
  character: string | null,
): LanguageServerCompletionEditFeature {
  if (character === null) return feature

  return {
    applyCompletion: (application) =>
      feature.applyCompletion(completionCommitApplication(application, character)),
  }
}

/**
 * The acceptance with the commit character appended to what the item inserts.
 *
 * The character is why the item was accepted, so it has to end up after the insertion exactly as it
 * was typed — `arr.fil` committed on `(` reads `arr.filter(`, and dropping the character is the one
 * outcome that makes the interaction worse than not having it.
 */
function completionCommitApplication(
  application: LanguageServerCompletionApplication,
  character: string,
): LanguageServerCompletionApplication {
  const [insertion, ...additional] = application.edits
  if (!insertion) return application

  const edits = [{ ...insertion, text: `${insertion.text}${character}` }, ...additional]
  // A snippet's caret belongs on its first placeholder, and the character lands past the end of the
  // insertion, so every stop measured inside it is still where it was.
  if (application.snippetStops) return { ...application, edits }

  const head = application.selection.head + character.length
  return { edits, selection: { ...application.selection, anchor: head, head } }
}
