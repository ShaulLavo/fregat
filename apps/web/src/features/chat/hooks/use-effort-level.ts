import { modelOptionDescriptors } from '@workspace/client-core/chat/providers/options'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { composerEffortLevel } from '@/features/chat/utils/effort-tier'

/** The composer's effort level; `undefined` until the model's options are known. */
export function useEffortLevel(draftTarget: ChatInputDraftTarget) {
  const { modelSelection, provider } = useModelPicker()
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const descriptors = model ? modelOptionDescriptors(model) : []

  // Selects the level, not the prompt, so typing re-renders only when the level changes.
  return useChatInputDraftStore((state) => {
    if (!modelSelection || descriptors.length === 0) return undefined
    return composerEffortLevel(descriptors, modelSelection, state.getDraft(draftTarget).prompt)
  })
}
