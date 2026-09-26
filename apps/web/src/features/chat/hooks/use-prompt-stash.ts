import { useStore } from 'zustand'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { errorMessage } from '@/lib/error-message'
import { useChatInputEditorActions } from './use-chat-input-editor-actions'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { promptStashStoreFor, type PromptStashEntry } from '../state/prompt-stash-store'
import { transferStash } from '../state/stash-transfer'
import { chatMutationKeys } from '../utils/mutation-keys'
import { toastError } from '@/lib/toast-error'

export function usePromptStash(draftTarget: ChatInputDraftTarget) {
  const editor = useChatInputEditorActions()
  const activeTarget = useRef<ChatInputDraftTarget | null>(draftTarget)
  useLayoutEffect(() => {
    activeTarget.current = draftTarget
    return () => {
      activeTarget.current = null
    }
  }, [draftTarget])
  const stashStore = promptStashStoreFor(draftTarget.environmentId)
  const entries = useStore(stashStore, (state) => state.entries)
  const [menuOpen, setMenuOpen] = useState(false)
  const mutation = useMutation({
    mutationKey: chatMutationKeys.stash(draftTarget.environmentId, draftTarget.draftKey),
    scope: { id: `stash:${draftTarget.environmentId}` },
    mutationFn: (input: {
      target: ChatInputDraftTarget
      action: Parameters<typeof transferStash>[1]
    }) => transferStash(input.target, input.action),
    onSuccess: (content, { target, action }) => {
      const current = activeTarget.current
      if (
        !current ||
        target.environmentId !== current.environmentId ||
        target.rootPath !== current.rootPath ||
        target.draftKey !== current.draftKey
      )
        return
      if (!content) {
        if (action.kind === 'stash') setMenuOpen(true)
        return
      }
      if (useChatInputDraftStore.getState().getDraft(draftTarget).prompt !== content.prompt) return
      editor.replacePrompt(content.prompt, action.kind === 'restore')
      setMenuOpen(false)
    },
    onError: (error) => toastError(errorMessage(error, 'Could not transfer the message stash.')),
  })
  const { mutate } = mutation
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !['s', 'S'].includes(event.key) ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return
      if (!editor.hasFocus()) return
      event.preventDefault()
      mutate({ target: draftTarget, action: { kind: 'stash' } })
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [draftTarget, editor, mutate])
  return {
    entries,
    pending: mutation.isPending,
    menuOpen,
    setMenuOpen,
    removeEntry: (entry: PromptStashEntry) =>
      mutation.mutate({ target: draftTarget, action: { kind: 'remove', entry } }),
    restoreEntry: (entry: PromptStashEntry) =>
      mutation.mutate({ target: draftTarget, action: { kind: 'restore', entry } }),
  }
}
