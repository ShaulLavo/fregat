export type OwnedTextState = {
  /** What the field shows. Advances synchronously on every keystroke. */
  readonly text: string
  /** The owner's value as of the last render; a change from it is the owner catching up or speaking. */
  readonly seen: string
  /** Values committed since the owner last caught up, oldest first. */
  readonly pending: readonly string[]
}

export function initialOwnedText(external: string): OwnedTextState {
  return { text: external, seen: external, pending: [] }
}

export function commitOwnedText(state: OwnedTextState, next: string): OwnedTextState {
  return { ...state, text: next, pending: [...state.pending, next] }
}

/**
 * The owner's value moved. If it is one of ours arriving late, drop it and anything older and keep
 * the field as typed; anything else is the owner speaking (history, clear, load) and replaces it.
 */
export function settleOwnedText(state: OwnedTextState, external: string): OwnedTextState {
  const index = state.pending.indexOf(external)
  if (index === -1) return { text: external, seen: external, pending: [] }
  return { text: state.text, seen: external, pending: state.pending.slice(index + 1) }
}
