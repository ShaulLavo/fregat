import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical'
import { useEffect } from 'react'

import { useSettingValue } from '@/hooks/use-setting-value'
import { composerEnterIntent } from '@/features/chat/utils/enter-intent'
import { $readChatInputTextSnapshot } from '@/features/chat/utils/input-editor-actions'

/**
 * Enter submits per `chat.sendShortcut`. The alternate send is each composer's to define:
 * a running session swaps queue and steer, a new draft starts in the background.
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
  const sendShortcut = useSettingValue('chat.sendShortcut')

  useKeymapNode({
    area: 'chat',
    context: 'Composer',
    element: () => editor.getRootElement(),
    commands: {
      'chat.sendMessage': ({ source }) => {
        if (disabled || commandMenuOpen || editor.isComposing() || !editor.isEditable())
          return false
        const intent = source
          ? composerEnterIntent({
              modifierKey: source.metaKey || source.ctrlKey,
              prompt: editor.getEditorState().read(() => $readChatInputTextSnapshot().text),
              sendShortcut,
              shiftKey: source.shiftKey,
            })
          : 'send'
        if (intent === 'newline') return false
        void onSubmitRequest(intent === 'alternate')
        return true
      },
    },
  })

  useEffect(() => {
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) =>
        handleEnterCommand({
          commandMenuOpen,
          disabled,
          event,
          onCommandMenuCommit,
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
  }, [commandMenuOpen, disabled, editor, onCommandMenuCommit, onCommandMenuMove])

  return null
}

function handleEnterCommand({
  commandMenuOpen,
  disabled,
  event,
  onCommandMenuCommit,
}: {
  commandMenuOpen: boolean
  disabled: boolean
  event: KeyboardEvent | null
  onCommandMenuCommit: () => boolean
}) {
  if (disabled) return false
  if (event && isImeCompositionEnter(event)) {
    // IME Enter commits text and still needs its native default.
    event.stopPropagation()
    return true
  }
  if (!event?.shiftKey && handleMenuCommitCommand(commandMenuOpen, event, onCommandMenuCommit))
    return true
  return false
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
