import { create } from 'zustand'

import {
  normalizeTerminalContextSelection,
  type TerminalContextSelection,
} from '@workspace/client-core/chat/terminal-context'
import type { ChatInputTerminalContext } from './chat-input-draft-store'

/**
 * Work handed to the composer from somewhere outside chat, waiting for a
 * composer to take it.
 *
 * A queue rather than a handle on the editor, because at capture time there
 * usually is no composer: the terminal is right-clicked while the workbench
 * sidebar is on Files, so `ChatInput` only mounts once the reveal that follows
 * switches the tab. That is also why the reference's `composerHandleContext`
 * shape does not transfer — a ref to a component that is not mounted is null.
 *
 * Two entry kinds, because capture surfaces produce two different things: a
 * chip that rides beside the prompt, and text that belongs in it.
 */
export type ComposerInboxEntry =
  | { readonly kind: 'terminal-context'; readonly context: ChatInputTerminalContext }
  | { readonly kind: 'text'; readonly text: string }
  /** Text for the end of the prompt, added once: a prompt already ending with it keeps as is. */
  | { readonly kind: 'append'; readonly text: string }

type ComposerInboxState = {
  pending: readonly ComposerInboxEntry[]
}

type ComposerInboxActions = {
  /**
   * Removes and returns only the entries `accept` claims, leaving the rest
   * queued. Taking rather than draining is what lets a composer whose editor has
   * not mounted yet collect its chips without dropping the text it cannot place
   * — and the nothing-taken case keeps `pending`'s identity, so the effect that
   * calls this cannot wake itself in a loop.
   */
  take: (accept: (entry: ComposerInboxEntry) => boolean) => readonly ComposerInboxEntry[]
  /** Text to splice in at the caret. Returns false for nothing worth inserting. */
  queueText: (text: string) => boolean
  queueAppend: (text: string) => boolean
  queueTerminalContext: (selection: TerminalContextSelection) => ChatInputTerminalContext | null
}

export type ComposerInboxStore = ComposerInboxState & ComposerInboxActions

const NO_PENDING: readonly ComposerInboxEntry[] = []

export const useComposerInboxStore = create<ComposerInboxStore>((set, get) => ({
  pending: NO_PENDING,
  take: (accept) => {
    const { pending } = get()
    const taken = pending.filter((entry) => accept(entry))
    if (taken.length === 0) return NO_PENDING

    set({ pending: pending.filter((entry) => !accept(entry)) })

    return taken
  },
  queueText: (text) => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return false

    set((state) => ({ pending: state.pending.concat({ kind: 'text', text: trimmed }) }))

    return true
  },
  queueAppend: (text) => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return false

    set((state) => ({ pending: state.pending.concat({ kind: 'append', text: trimmed }) }))

    return true
  },
  // Normalized on the way in so a drag that caught only padding never becomes a
  // chip; the null return is what lets the caller say "nothing was selected".
  queueTerminalContext: (selection) => {
    const normalized = normalizeTerminalContextSelection(selection)
    if (!normalized) return null

    const context: ChatInputTerminalContext = {
      ...normalized,
      id: `terminal-context-${crypto.randomUUID()}`,
    }
    set((state) => ({ pending: state.pending.concat({ context, kind: 'terminal-context' }) }))

    return context
  },
}))

export function resetComposerInboxStore() {
  useComposerInboxStore.setState({ pending: NO_PENDING })
}
