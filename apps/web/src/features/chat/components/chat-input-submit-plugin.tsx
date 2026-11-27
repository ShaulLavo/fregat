import { useEffect } from 'react'

import { useChatInputEditor } from '@/features/chat/providers/composer-editor-context'
import { composerEnterIntent } from '@/features/chat/utils/enter-intent'
import { readChatInputText } from '@/features/chat/utils/input-editor-actions'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'

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
  const editor = useChatInputEditor()
  const sendShortcut = useSettingValue('chat.sendShortcut')

  useKeymapNode({
    area: 'chat',
    context: 'Composer',
    element: () => editor?.getInputElement() ?? null,
    commands: {
      'chat.sendMessage': ({ source }) => {
        if (!editor || disabled || commandMenuOpen || editor.isComposing() || !editor.isEditable())
          return false
        if (source && isImeCompositionEnter(source)) return false
        const intent = source
          ? composerEnterIntent({
              modifierKey: source.metaKey || source.ctrlKey,
              prompt: readChatInputText(editor),
              sendShortcut,
              shiftKey: source.shiftKey,
              touch: touchKeyboard(),
            })
          : 'send'
        if (intent === 'newline') return false
        void onSubmitRequest(intent === 'alternate')
        return true
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const inputElement = editor.getInputElement()
    const onKeyDown = (event: KeyboardEvent) =>
      handleComposerKeyDown({
        commandMenuOpen,
        disabled,
        event,
        onCommandMenuCommit,
        onCommandMenuMove,
      })
    inputElement.addEventListener('keydown', onKeyDown, true)
    return () => inputElement.removeEventListener('keydown', onKeyDown, true)
  }, [commandMenuOpen, disabled, editor, onCommandMenuCommit, onCommandMenuMove])

  return null
}

function handleComposerKeyDown({
  commandMenuOpen,
  disabled,
  event,
  onCommandMenuCommit,
  onCommandMenuMove,
}: {
  commandMenuOpen: boolean
  disabled: boolean
  event: KeyboardEvent
  onCommandMenuCommit: () => boolean
  onCommandMenuMove: (offset: number) => boolean
}) {
  if (event.key === 'Enter') {
    handleEnterCommand({ commandMenuOpen, disabled, event, onCommandMenuCommit })
    return
  }
  if (event.key === 'Tab') {
    handleMenuCommitCommand(commandMenuOpen, event, onCommandMenuCommit)
    return
  }
  if (event.key === 'ArrowDown') {
    handleMenuMoveCommand(commandMenuOpen, event, onCommandMenuMove, 1)
    return
  }
  if (event.key === 'ArrowUp') {
    handleMenuMoveCommand(commandMenuOpen, event, onCommandMenuMove, -1)
  }
}

function handleEnterCommand({
  commandMenuOpen,
  disabled,
  event,
  onCommandMenuCommit,
}: {
  commandMenuOpen: boolean
  disabled: boolean
  event: KeyboardEvent
  onCommandMenuCommit: () => boolean
}) {
  if (disabled) return false
  if (isImeCompositionEnter(event)) {
    // IME Enter commits text and still needs its native default.
    event.stopPropagation()
    return true
  }
  if (!event.shiftKey && handleMenuCommitCommand(commandMenuOpen, event, onCommandMenuCommit))
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
  event: KeyboardEvent,
  onCommandMenuCommit: () => boolean,
) {
  if (!commandMenuOpen) return false
  if (!onCommandMenuCommit()) return false

  event.preventDefault()
  event.stopPropagation()
  return true
}

function handleMenuMoveCommand(
  commandMenuOpen: boolean,
  event: KeyboardEvent,
  onCommandMenuMove: (offset: number) => boolean,
  offset: number,
) {
  if (!commandMenuOpen) return false
  if (!onCommandMenuMove(offset)) return false

  event.preventDefault()
  event.stopPropagation()
  return true
}

/** A device whose main pointer is a finger: its on-screen keyboard has no Shift+Return habit. */
function touchKeyboard() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
}
