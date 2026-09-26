import { modelOptionDescriptors } from '@workspace/client-core/chat/providers/options'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { composerEffortTier } from '@/features/chat/utils/effort-tier'

/** The composer's effort tier; `undefined` until the model's options are known. */
export function useEffortTier(draftTarget: ChatInputDraftTarget) {
  const { modelSelection, provider } = useModelPicker()
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const descriptors = model ? modelOptionDescriptors(model) : []

  // Selects the tier, not the prompt, so typing re-renders only when the tier changes.
  return useChatInputDraftStore((state) => {
    if (!modelSelection || descriptors.length === 0) return undefined
    return composerEffortTier(descriptors, modelSelection, state.getDraft(draftTarget).prompt)
  })
}
