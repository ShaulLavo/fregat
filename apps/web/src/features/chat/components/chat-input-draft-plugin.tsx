import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import type { EditorState, LexicalEditor } from 'lexical'
import { useCallback, useEffect, type RefObject } from 'react'

import { detectChatInputTrigger, type ChatInputTrigger } from '@/features/chat/utils/input-logic'
import { $readChatInputTextSnapshot } from '@/features/chat/utils/input-editor-actions'
import { useChatInputDraftStore } from '../state/chat-input-draft-store'

export function ChatInputDraftPlugin({
  busy,
  disabled,
  draftKey,
  hasStagedContent,
  onEditorReady,
  onTriggerChange,
  rootPath,
  sendButtonRef,
  submitting,
  submissionDisabled,
}: {
  busy: boolean
  disabled: boolean
  draftKey: string
  hasStagedContent: boolean
  onEditorReady: (editor: LexicalEditor | null) => void
  onTriggerChange: (trigger: ChatInputTrigger | null) => void
  rootPath: string
  sendButtonRef: RefObject<HTMLButtonElement | null>
  submitting: boolean
  submissionDisabled: boolean
}) {
  const environmentId = useEnvironmentId()
  const [editor] = useLexicalComposerContext()
  const setPrompt = useChatInputDraftStore((store) => store.setPrompt)
  const updateSendButton = useCallback(
    (text: string) => {
      updateSendButtonDisabled(sendButtonRef.current, {
        busy,
        disabled,
        hasStagedContent,
        submitting,
        submissionDisabled,
        text,
      })
    },
    [busy, disabled, hasStagedContent, sendButtonRef, submitting, submissionDisabled],
  )

  useEffect(() => {
    onEditorReady(editor)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    updateSendButton(readCurrentEditorText(editor))
  }, [editor, updateSendButton])

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const { cursor, text } = $readChatInputTextSnapshot()
        setPrompt({ environmentId, draftKey, rootPath }, text)
        onTriggerChange(detectChatInputTrigger(text, cursor))
        updateSendButton(text)
      })
    },
    [environmentId, draftKey, onTriggerChange, rootPath, setPrompt, updateSendButton],
  )

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
}

function readCurrentEditorText(editor: LexicalEditor) {
  let text = ''
  editor.getEditorState().read(() => {
    text = $readChatInputTextSnapshot().text
  })

  return text
}

function updateSendButtonDisabled(
  button: HTMLButtonElement | null,
  {
    disabled,
    hasStagedContent,
    submitting,
    submissionDisabled,
    text,
  }: {
    busy: boolean
    disabled: boolean
    hasStagedContent: boolean
    submitting: boolean
    submissionDisabled: boolean
    text: string
  },
) {
  if (!button) return

  if (disabled || submitting || submissionDisabled) {
    button.disabled = true
    return
  }

  button.disabled = !hasStagedContent && !text.trim()
}
