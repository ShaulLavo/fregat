import type { Editor } from '@singapore-editor/core/editor'
import { modelOptionDescriptors } from '@workspace/client-core/chat/providers/options'
import { useEffect } from 'react'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { ultrathinkRainbow } from '@/features/chat/utils/ultrathink-rainbow'

/** Paints the word "ultrathink" in the rainbow while the model lets it switch the effort. */
export function ChatInputUltrathink({
  draftTarget,
  editor,
}: {
  readonly draftTarget: ChatInputDraftTarget
  readonly editor: Editor | null
}) {
  const { modelSelection, provider } = useModelPicker()
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const effort = model
    ? modelOptionDescriptors(model).find((descriptor) => descriptor.type === 'select')
    : undefined
  const enabled = Boolean(effort?.type === 'select' && effort.promptInjectedValues?.length)
  const prompt = useChatInputDraftStore((store) => store.getDraft(draftTarget).prompt)

  useEffect(() => {
    editor?.setRangeDecorations(enabled ? ultrathinkRainbow(prompt) : [])
  }, [editor, enabled, prompt])

  return null
}
