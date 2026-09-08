import {
  normalizeTerminalContextSelection,
  normalizeTerminalContextText,
  type TerminalContextSelection,
} from '@workspace/client-core/chat/terminal-context'

/**
 * The slice of ghostty's `Terminal` a capture needs. Structural rather than the
 * class itself so the capture can be exercised without a WASM terminal, and so
 * nothing else about the emulator leaks into the chat-facing contract.
 */
export type TerminalSelectionSource = {
  readonly getSelection: () => string | undefined
  readonly selectionCoordinates: () => TerminalSelectionRange | undefined
}

type TerminalSelectionRange = {
  readonly start: { readonly y: number }
}

/**
 * Snapshots what is selected right now. It has to be called while the selection
 * still exists — ghostty drops it from a document-level `click` handler — so the
 * menu captures at open time rather than when an item runs.
 */
export function captureTerminalSelection(
  terminal: TerminalSelectionSource,
  source: string,
): TerminalContextSelection | null {
  const text = normalizeTerminalContextText(terminal.getSelection() ?? '')
  if (text.length === 0) return null

  const lineStart = selectionStartLine(terminal.selectionCoordinates())

  return normalizeTerminalContextSelection({
    // Derived from the captured text, not from the range's end: ghostty's end
    // coordinate is the cell after the selection, so a drag released at column
    // 0 would claim a trailing line that contributed nothing.
    lineEnd: lineStart + text.split('\n').length - 1,
    lineStart,
    source,
    text,
  })
}

/** Buffer rows are 0-based and count scrollback; the label reads 1-based. */
function selectionStartLine(range: TerminalSelectionRange | undefined) {
  if (!range) return 1

  return Math.max(1, Math.floor(range.start.y) + 1)
}
