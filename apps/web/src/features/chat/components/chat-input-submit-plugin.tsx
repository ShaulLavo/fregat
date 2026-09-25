import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical'
import { useEffect } from 'react'

/**
 * Enter submits. Ctrl/Cmd+Enter submits the alternate intent, which each composer
 * defines: a running session swaps queue and steer, a new draft starts in the background.
 */
export function ChatInputSubmitPlugin({
  commandMenuOpen,
  disabled,
  onCommandMenuCommit,
  onCommandMenuMove,
  onSubmitRequest,
}: {
  commandMenuOpen: boolean
  disabled: boolean
  onCommandMenuCommit: () => boolean
  onCommandMenuMove: (offset: number) => boolean
  onSubmitRequest: (alternate?: boolean) => Promise<boolean>
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) =>
        handleEnterCommand({
          commandMenuOpen,
          disabled,
          event,
          onCommandMenuCommit,
          onSubmitRequest,
        }),
      COMMAND_PRIORITY_HIGH,
    )
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => handleMenuCommitCommand(commandMenuOpen, event, onCommandMenuCommit),
      COMMAND_PRIORITY_HIGH,
    )
    const unregisterArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => handleMenuMoveCommand(commandMenuOpen, event, onCommandMenuMove, 1),
      COMMAND_PRIORITY_HIGH,
    )
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleMenuMoveCommand(commandMenuOpen, event, onCommandMenuMove, -1),
      COMMAND_PRIORITY_HIGH,
    )

    return () => {
      unregisterEnter()
      unregisterTab()
      unregisterArrowDown()
      unregisterArrowUp()
    }
  }, [
    commandMenuOpen,
    disabled,
    editor,
    onCommandMenuCommit,
    onCommandMenuMove,
    onSubmitRequest,
  ])

  return null
}

function handleEnterCommand({
  commandMenuOpen,
  disabled,
  event,
  onCommandMenuCommit,
  onSubmitRequest,
}: {
  commandMenuOpen: boolean
  disabled: boolean
  event: KeyboardEvent | null
  onCommandMenuCommit: () => boolean
  onSubmitRequest: (alternate?: boolean) => Promise<boolean>
}) {
  if (disabled) return false
  if (event && isImeCompositionEnter(event)) {
    // The keystroke belongs to the IME, which is committing a composition —
    // sending here would ship a half-composed message. Swallowed rather than
    // prevented: the IME still needs its own default to land the characters.
    event.stopPropagation()
    return true
  }
  if (event?.shiftKey) return false
  if (handleMenuCommitCommand(commandMenuOpen, event, onCommandMenuCommit)) return true

  event?.preventDefault()
  event?.stopPropagation()
  void onSubmitRequest(Boolean(event?.metaKey || event?.ctrlKey))

  return true
}

/**
 * `keyCode` 229 is the pre-`isComposing` signal every IME still sends, and some
 * of them (macOS Japanese, Windows Chinese) only set that one on the commit
 * keystroke, so both signals have to count.
 */
function isImeCompositionEnter(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229
}

function handleMenuCommitCommand(
  commandMenuOpen: boolean,
  event: KeyboardEvent | null,
  onCommandMenuCommit: () => boolean,
) {
  if (!commandMenuOpen) return false
  if (!onCommandMenuCommit()) return false

  event?.preventDefault()
  event?.stopPropagation()
  return true
}

function handleMenuMoveCommand(
  commandMenuOpen: boolean,
  event: KeyboardEvent | null,
  onCommandMenuMove: (offset: number) => boolean,
  offset: number,
) {
  if (!commandMenuOpen) return false
  if (!onCommandMenuMove(offset)) return false

  event?.preventDefault()
  event?.stopPropagation()
  return true
}
