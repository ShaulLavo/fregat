import { createContext } from 'react'

/** What composer controls outside the editor may do to the prompt it holds. */
export type ChatInputEditorActions = {
  /** Replaces the prompt without an undo entry, and optionally puts the caret in it. */
  readonly replacePrompt: (text: string, focus: boolean) => void
  /** Whether the keyboard is in the composer's text. */
  readonly hasFocus: () => boolean
}

export const ChatInputEditorContext = createContext<ChatInputEditorActions | null>(null)
