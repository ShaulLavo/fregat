import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'
import { SKIP_DOM_SELECTION_TAG } from 'lexical'
import { useStore } from 'zustand'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { use, useLayoutEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { errorMessage } from '@/lib/error-message'
import { $setChatInputText } from '../utils/input-editor-actions'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { promptStashStoreFor, type PromptStashEntry } from '../state/prompt-stash-store'
import { transferStash } from '../state/stash-transfer'
import { chatMutationKeys } from '../utils/mutation-keys'
import { toastError } from '@/lib/toast-error'
import { ComposerRootsContext } from '@/lib/composer-attach/providers/roots-context'

export function usePromptStash(draftTarget: ChatInputDraftTarget) {
  const [editor] = useLexicalComposerContext()
  const activeTarget = useRef<ChatInputDraftTarget | null>(draftTarget)
  useLayoutEffect(() => {
    activeTarget.current = draftTarget
    return () => {
      activeTarget.current = null
    }
  }, [draftTarget])
  const aliasRoots = use(ComposerRootsContext)
  const stashStore = promptStashStoreFor(draftTarget.environmentId)
  const entries = useStore(stashStore, (state) => state.entries)
  const [menuOpen, setMenuOpen] = useState(false)
  const mutation = useMutation({
    mutationKey: chatMutationKeys.stash(draftTarget.environmentId, draftTarget.draftKey),
    scope: { id: `stash:${draftTarget.environmentId}` },
    mutationFn: (input: {
      target: ChatInputDraftTarget
      action: Parameters<typeof transferStash>[1]
    }) => transferStash(input.target, input.action, aliasRoots),
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
      editor.update(() => $setChatInputText(content.prompt), { tag: SKIP_DOM_SELECTION_TAG })
      if (action.kind === 'restore') editor.focus()
      setMenuOpen(false)
    },
    onError: (error) => toastError(errorMessage(error, 'Could not transfer the message stash.')),
  })
  const { mutate } = mutation
  useKeymapNode({
    area: 'chat',
    context: 'Composer',
    element: () => editor.getRootElement(),
    commands: {
      'chat.stashPrompt': () => {
        if (!activeTarget.current || !editor.isEditable()) return false
        mutate({ target: draftTarget, action: { kind: 'stash' } })
        return true
      },
    },
  })
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
