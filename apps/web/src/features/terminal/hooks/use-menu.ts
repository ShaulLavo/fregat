import { useEffect, useState } from 'react'

import { useAttachToComposer } from '@/features/chat/hooks/use-attach-to-composer'
import { isClipboardReadBlocked } from '@/features/terminal/utils/clipboard'
import {
  pasteFromClipboard,
  resetTerminal,
  selectAllInTerminal,
  type TerminalMenuTarget,
} from '@/features/terminal/utils/commands'
import { terminalMenu } from '@/features/terminal/utils/menu'
import { copyTextToClipboard } from '@/lib/clipboard'

export function useTerminalMenu(target: TerminalMenuTarget) {
  // Asked per open rather than once per app: the user can grant or revoke
  // clipboard access from the omnibox at any time, and this hook only runs
  // while a menu is actually on screen.
  const [pasteBlocked, setPasteBlocked] = useState(false)
  const { attachTerminalContext } = useAttachToComposer()

  useEffect(() => {
    let active = true

    void isClipboardReadBlocked().then((blocked) => {
      if (!active) return

      setPasteBlocked(blocked)
    })

    return () => {
      active = false
    }
  }, [])

  return terminalMenu({
    // Both read the snapshot taken when the menu opened, never the live
    // terminal: ghostty drops the selection from a document `click` handler as
    // the portalled item is pressed, so a run-time read is always empty.
    askAgent: () => attachTerminalContext(target.contextSelection),
    canAskAgent: target.contextSelection !== null,
    clear: target.clearHistory,
    restart: target.restart,
    copySelection: () => void copyTextToClipboard(target.selection, 'selection'),
    hasScrollback: target.hasScrollback,
    hasSelection: target.selection.length > 0,
    paste: () => void pasteFromClipboard(target.terminal),
    pasteBlocked,
    reset: () => resetTerminal(target.terminal),
    scrollToBottom: () => target.terminal.scrollToBottom(),
    scrollToTop: () => target.terminal.scrollToTop(),
    selectAll: () => selectAllInTerminal(target.terminal),
  })
}
