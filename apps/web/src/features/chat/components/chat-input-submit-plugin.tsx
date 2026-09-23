import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical'
import { useEffect } from 'react'

export function ChatInputSubmitPlugin({
  busy = false,
  commandMenuOpen,
  disabled,
  onCommandMenuCommit,
  onCommandMenuMove,
  onSubmitRequest,
}: {
  commandMenuOpen: boolean
  busy?: boolean
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
          busy,
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
    busy,
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
  busy,
  commandMenuOpen,
  disabled,
  event,
  onCommandMenuCommit,
  onSubmitRequest,
}: {
  busy: boolean
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
  void onSubmitRequest(busy && Boolean(event?.metaKey || event?.ctrlKey))

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
