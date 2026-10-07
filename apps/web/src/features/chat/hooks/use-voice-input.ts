import { useIsMutating, useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from 'zustand'
import type { LexicalEditor } from 'lexical'

import { useSettingValue } from '@/hooks/use-setting-value'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { BrowserVoiceInput, browserSpeechRecognition } from '../utils/browser-voice-input'
import { readChatInputSelection, replaceChatInputEditorRange } from '../utils/input-editor-actions'
import { chatMutationKeys } from '../utils/mutation-keys'
import { resolveTranscriptCommit } from '../utils/voice-draft'
import { voiceErrors } from '../utils/voice-errors'

export function useVoiceInput(
  draftTarget: ChatInputDraftTarget,
  editorRef: RefObject<LexicalEditor | null>,
) {
  const [capture] = useState(() => new BrowserVoiceInput())
  const phase = useStore(capture.store, (state) => state.phase)
  const elapsedSeconds = useStore(capture.store, (state) => state.elapsedSeconds)
  const preview = useStore(capture.store, (state) => state.preview)
  const limitSeconds = useSettingValue('chat.dictationLimitSeconds')
  const ownerKey = `${draftTarget.environmentId}:${draftTarget.rootPath}:${draftTarget.draftKey}`
  const currentOwner = useRef(ownerKey)
  const mutationKey = chatMutationKeys.voice(ownerKey)
  const pending = useIsMutating({ mutationKey }, resourceQueryClient) > 0
  const anyPending =
    useIsMutating({ mutationKey: chatMutationKeys.voiceAll }, resourceQueryClient) > 0
  const mutation = useMutation(
    {
      mutationKey,
      scope: { id: 'chat-voice-input' },
      retry: false,
      networkMode: 'always',
      mutationFn: () =>
        dictateDraft({ capture, editorRef, currentOwner, ownerKey, draftTarget, limitSeconds }),
    },
    resourceQueryClient,
  )
  const reset = mutation.reset
  useEffect(() => {
    currentOwner.current = ownerKey
    reset()
    return () => capture.cancel()
  }, [capture, ownerKey, reset])
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) capture.cancel()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [capture])

  return {
    supported: browserSpeechRecognition() !== null,
    pending,
    anyPending,
    phase,
    elapsedSeconds,
    preview,
    error: mutation.error,
    start: () => {
      if (resourceQueryClient.isMutating({ mutationKey: chatMutationKeys.voiceAll }) === 0)
        mutation.mutate()
    },
    finish: () => capture.finish(),
    cancel: () => {
      capture.cancel()
      mutation.reset()
    },
  }
}

async function dictateDraft({
  capture,
  editorRef,
  currentOwner,
  ownerKey,
  draftTarget,
  limitSeconds,
}: {
  readonly capture: BrowserVoiceInput
  readonly editorRef: RefObject<LexicalEditor | null>
  readonly currentOwner: RefObject<string>
  readonly ownerKey: string
  readonly draftTarget: ChatInputDraftTarget
  readonly limitSeconds: number
}) {
  const Recognition = browserSpeechRecognition()
  const editor = editorRef.current
  if (!Recognition || !editor || currentOwner.current !== ownerKey) return null
  const captured = { ...readChatInputSelection(editor), ownerKey, revision: 0 }
  const locale = navigator.language
  let revision = 0
  let lastText = useChatInputDraftStore.getState().getDraft(draftTarget).prompt
  const unsubscribe = useChatInputDraftStore.subscribe((state) => {
    const text = state.getDraft(draftTarget).prompt
    if (text !== lastText) revision += 1
    lastText = text
  })
  try {
    const transcript = await capture.run(Recognition, locale, limitSeconds)
    if (transcript === null) return null
    const current =
      editorRef.current === editor
        ? { ...readChatInputSelection(editor), ownerKey: currentOwner.current, revision }
        : null
    const result = resolveTranscriptCommit(captured, current, transcript, locale)
    if (result.kind === 'empty') throw voiceErrors.EMPTY({ internal: { phase: 'completed' } })
    if (result.kind === 'stale')
      throw voiceErrors.STALE({
        internal: {
          revision,
          editorMatches: editorRef.current === editor,
          ownerMatches: currentOwner.current === ownerKey,
          textMatches: current?.text === captured.text,
        },
      })
    const replacement = result.text.slice(captured.selection.start, result.selection.start)
    const applied = replaceChatInputEditorRange(editor, {
      expectedText: captured.text.slice(captured.selection.start, captured.selection.end),
      rangeStart: captured.selection.start,
      rangeEnd: captured.selection.end,
      replacement,
      focus: true,
    })
    if (!applied) throw voiceErrors.STALE({ internal: { revision, phase: 'commit' } })
    useChatInputDraftStore.getState().setPrompt(draftTarget, applied.text)
    return applied.text
  } finally {
    unsubscribe()
  }
}
