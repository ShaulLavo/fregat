import { useEffect, useEffectEvent } from 'react'

import { useChatInputEditor } from '@/features/chat/providers/composer-editor-context'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  readChatInputText,
  readChatInputTextSnapshot,
  setChatInputText,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import { detectChatInputTrigger, type ChatInputTrigger } from '@/features/chat/utils/input-logic'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'

export function ChatInputDraftPlugin({
  disabled,
  draftKey,
  onEditorReady,
  onTriggerChange,
  rootPath,
}: {
  disabled: boolean
  draftKey: string
  onEditorReady: (editor: ChatInputEditorHandle | null) => void
  onTriggerChange: (trigger: ChatInputTrigger | null) => void
  rootPath: string
}) {
  const environmentId = useEnvironmentId()
  const editor = useChatInputEditor()
  const setPrompt = useChatInputDraftStore((store) => store.setPrompt)

  const handleTransaction = useEffectEvent((currentEditor: ChatInputEditorHandle) => {
    const { cursor, text } = readChatInputTextSnapshot(currentEditor)
    setPrompt({ environmentId, draftKey, rootPath }, text)
    onTriggerChange(detectChatInputTrigger(text, cursor))
  })

  useEffect(() => {
    onEditorReady(editor)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor) return
    const target = { environmentId, draftKey, rootPath }
    const syncPrompt = () => {
      const prompt = useChatInputDraftStore.getState().getDraft(target).prompt
      if (readChatInputText(editor) === prompt) return
      setChatInputText(editor, prompt, { syncOnly: true })
    }
    syncPrompt()
    return useChatInputDraftStore.subscribe(syncPrompt)
  }, [editor, environmentId, draftKey, rootPath])

  useEffect(() => {
    if (!editor) return
    const disposable = editor.editor.onDidTransaction(() => {
      handleTransaction(editor)
    })
    return () => disposable.dispose()
  }, [editor])

  return null
}
