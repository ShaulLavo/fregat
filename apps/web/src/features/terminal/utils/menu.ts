import {
  ArrowClockwiseIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  BroomIcon,
  ChatCircleIcon,
  ClipboardTextIcon,
  CopyIcon,
  GraphicsCardIcon,
  SelectionAllIcon,
} from '@phosphor-icons/react'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'
import { formatChord } from '@/keymap/utils/format-keys'
import {
  rendererBackendLabel,
  type TerminalRendererBackend,
} from '@/features/terminal/utils/renderer-backend'

/**
 * Everything the menu needs to know about the terminal, read once when the
 * menu opens. The selection in particular cannot be read later: ghostty clears
 * it from a document-level `click` handler the moment a portalled menu item is
 * pressed, so an item that read it inside its own `run` would always see "".
 */
export type TerminalMenuContext = {
  /** Stages the selected lines on the chat composer and brings it on screen. */
  readonly askAgent: () => void
  /** False when the selection normalizes away — whitespace, or a terminal with no id. */
  readonly canAskAgent: boolean
  readonly clear: () => void
  readonly copySelection: () => void
  /** No scrollback means both scroll actions are meaningless, not disabled. */
  readonly hasScrollback: boolean
  readonly hasSelection: boolean
  readonly paste: () => void
  /** The browser refuses programmatic clipboard reads for this origin. */
  readonly pasteBlocked: boolean
  readonly rendererBackend: TerminalRendererBackend
  readonly reset: () => void
  readonly restart: () => void
  readonly scrollToBottom: () => void
  readonly scrollToTop: () => void
  readonly selectAll: () => void
}

export function terminalMenu(context: TerminalMenuContext): Menu {
  const pasteHotkey = formatChord('mod+v')

  return [
    // Above Copy: a failing command is the reason most people open this menu on
    // a selection, and handing it to the agent is what they want next.
    section('agent', [
      actionItem({
        disabled: !context.canAskAgent,
        icon: ChatCircleIcon,
        id: 'askAgent',
        label: 'Ask the Agent',
        run: context.askAgent,
      }),
    ]),
    section('clipboard', [
      actionItem({
        disabled: !context.hasSelection,
        icon: CopyIcon,
        id: 'copy',
        label: 'Copy',
        run: context.copySelection,
      }),
      actionItem({
        icon: ClipboardTextIcon,
        id: 'paste',
        label: 'Paste',
        run: context.paste,
        shortcut: pasteHotkey,
        // Blocked paste stays visible but disabled, with the native shortcut in
        // the trailing slot: the keyboard path still works even when the
        // Clipboard API will not hand us the text.
        unavailable: context.pasteBlocked ? pasteHotkey : undefined,
      }),
      actionItem({
        icon: SelectionAllIcon,
        id: 'selectAll',
        label: 'Select All',
        run: context.selectAll,
      }),
    ]),
    section('screen', [
      actionItem({
        icon: BroomIcon,
        id: 'clear',
        label: 'Clear',
        run: context.clear,
      }),
      actionItem({
        // Reset rebuilds this viewer without clearing shared history.
        destructive: true,
        icon: ArrowClockwiseIcon,
        id: 'reset',
        label: 'Reset',
        run: context.reset,
      }),
      actionItem({
        icon: ArrowClockwiseIcon,
        id: 'restart',
        label: 'Restart shell',
        destructive: true,
        run: context.restart,
      }),
    ]),
    section('scroll', [
      context.hasScrollback &&
        actionItem({
          icon: ArrowLineUpIcon,
          id: 'scrollToTop',
          label: 'Scroll to Top',
          run: context.scrollToTop,
        }),
      context.hasScrollback &&
        actionItem({
          icon: ArrowLineDownIcon,
          id: 'scrollToBottom',
          label: 'Scroll to Bottom',
          run: context.scrollToBottom,
        }),
    ]),
    section('renderer', [
      actionItem({
        disabled: true,
        icon: GraphicsCardIcon,
        id: 'renderer',
        label: rendererBackendLabel(context.rendererBackend),
        mono: true,
        run: () => {},
      }),
    ]),
  ]
}
