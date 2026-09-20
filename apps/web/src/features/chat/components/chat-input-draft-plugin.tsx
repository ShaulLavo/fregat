import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { SKIP_DOM_SELECTION_TAG, type EditorState, type LexicalEditor } from 'lexical'
import { useCallback, useEffect } from 'react'

import { detectChatInputTrigger, type ChatInputTrigger } from '@/features/chat/utils/input-logic'
import {
  $readChatInputTextSnapshot,
  $setChatInputText,
  readChatInputText,
} from '@/features/chat/utils/input-editor-actions'
import { useChatInputDraftStore } from '../state/chat-input-draft-store'

export function ChatInputDraftPlugin({
  disabled,
  draftKey,
  onEditorReady,
  onTriggerChange,
  rootPath,
}: {
  disabled: boolean
  draftKey: string
  onEditorReady: (editor: LexicalEditor | null) => void
  onTriggerChange: (trigger: ChatInputTrigger | null) => void
  rootPath: string
}) {
  const environmentId = useEnvironmentId()
  const [editor] = useLexicalComposerContext()
  const setPrompt = useChatInputDraftStore((store) => store.setPrompt)
  useEffect(() => {
    onEditorReady(editor)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    const target = { environmentId, draftKey, rootPath }
    const syncPrompt = () => {
      const prompt = useChatInputDraftStore.getState().getDraft(target).prompt
      if (readChatInputText(editor) === prompt) return
      editor.update(() => $setChatInputText(prompt), { tag: SKIP_DOM_SELECTION_TAG })
    }
    syncPrompt()
    return useChatInputDraftStore.subscribe(syncPrompt)
  }, [editor, environmentId, draftKey, rootPath])

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const { cursor, text } = $readChatInputTextSnapshot()
        setPrompt({ environmentId, draftKey, rootPath }, text)
        onTriggerChange(detectChatInputTrigger(text, cursor))
      })
    },
    [environmentId, draftKey, onTriggerChange, rootPath, setPrompt],
  )

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
}
