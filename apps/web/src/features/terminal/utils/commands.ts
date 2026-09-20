import type { Terminal } from 'ghostty-webgpu'

import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

import { captureTerminalSelection } from './capture'
import { readClipboardText } from './clipboard'

/**
 * Ctrl+L. Sent to the PTY rather than handled locally: `Terminal.clear()` only
 * writes `ESC[2J` into the emulator, so the shell keeps thinking its prompt is
 * still on screen and redraws over a blank viewport on the next edit.
 */
const FORM_FEED = '\f'

/**
 * Read once when the menu opens. Holding the terminal here rather than reading
 * a ref during render keeps the menu bound to the instance that was actually
 * right-clicked, even if the panel rebuilds its terminal while the menu is up.
 */
export type TerminalMenuTarget = {
  /** The same selection typed for the agent, line numbers and all. */
  readonly clearHistory: () => void
  readonly restart: () => void
  readonly contextSelection: TerminalContextSelection | null
  readonly hasScrollback: boolean
  readonly selection: string
  readonly terminal: Terminal
}

export function readTerminalMenuTarget(
  terminal: Terminal,
  sessionId: string,
  hasScrollback: boolean,
  actions: Pick<TerminalMenuTarget, 'clearHistory' | 'restart'>,
): TerminalMenuTarget {
  return {
    ...actions,
    contextSelection: captureTerminalSelection(terminal, sessionId),
    hasScrollback,
    selection: terminal.getSelection() ?? '',
    terminal,
  }
}

/**
 * Rebuilds the emulator, then asks the shell to redraw: a bare reset leaves the
 * viewport blank with no prompt until the next command produces output.
 */
export function resetTerminal(terminal: Terminal) {
  terminal.reset()
  terminal.sendInput(FORM_FEED)
}

/**
 * ghostty clears the selection from a document-level `click` handler, and the
 * click that activated this item is still propagating. Selecting on the next
 * task lets that handler run first, against the empty selection it expects.
 */
export function selectAllInTerminal(terminal: Terminal) {
  window.setTimeout(() => terminal.selectAll(), 0)
}

/**
 * `readText` must be reached synchronously from the click so the browser still
 * sees a user gesture, which is why the read is not hoisted into the caller.
 * `Terminal.paste` wraps the text in bracketed-paste markers when the program
 * on the other end asked for them, so multi-line pastes stay inert.
 */
export async function pasteFromClipboard(terminal: Terminal) {
  const text = await readClipboardText()
  if (!text) return

  terminal.paste(text)
}
