import type { ModelSelection, ProviderInstanceId } from '@workspace/contracts'
import type { ReactNode } from 'react'

import { useProvider } from '@/features/chat/hooks/use-provider'
import type { ProviderModelOption } from '@workspace/client-core/chat/providers/models'
import { reconcileModelOptions } from '@workspace/client-core/chat/providers/options'
import { toggledModelSelection } from '@/features/chat/utils/multiple-models'
import {
  ChatModelPickerContext,
  type ChatModelPicker,
} from '@/features/chat/providers/model-picker-context'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'

const NO_MODELS: readonly ModelSelection[] = []

// The draft selection applies to the next turn; existing sessions keep their provider.
export function ChatModelPickerProvider({
  children,
  draftTarget,
  sessionProviderInstanceId,
  modelSelection,
  persistModelSelection,
}: {
  readonly children: ReactNode
  readonly draftTarget: ChatInputDraftTarget
  readonly sessionProviderInstanceId: ProviderInstanceId | null
  readonly modelSelection: ModelSelection | null
  /** Durable home for the pick, so the next new session starts on it. */
  readonly persistModelSelection: (modelSelection: ModelSelection) => void
}) {
  const draftModelSelection = useChatInputDraftStore(
    (state) => state.getDraft(draftTarget).modelSelection,
  )
  const setModelSelection = useChatInputDraftStore((state) => state.setModelSelection)
  const additionalModels = useChatInputDraftStore(
    (state) => state.getDraft(draftTarget).additionalModelSelections,
  )
  const activeModelSelection = draftModelSelection ?? modelSelection
  const provider = useProvider(activeModelSelection?.providerInstanceId)
  function selectModel(option: ProviderModelOption) {
    if (
      sessionProviderInstanceId !== null &&
      option.modelSelection.providerInstanceId !== sessionProviderInstanceId
    )
      return

    const next = reconcileModelOptions(
      activeModelSelection,
      option.modelSelection,
      option.optionDescriptors,
    )
    setModelSelection(draftTarget, next)
    persistModelSelection(next)
  }

  function toggleAdditionalModel(option: ProviderModelOption) {
    const next = toggledModelSelection(
      additionalModels,
      activeModelSelection,
      option.modelSelection,
    )
    useChatInputDraftStore.getState().setAdditionalModelSelections(draftTarget, next)
  }

  const value: ChatModelPicker = {
    sessionProviderInstanceId,
    modelSelection: activeModelSelection,
    provider,
    selectModel,
    additionalModels: sessionProviderInstanceId === null ? additionalModels : NO_MODELS,
    toggleAdditionalModel: sessionProviderInstanceId === null ? toggleAdditionalModel : null,
  }

  return <ChatModelPickerContext value={value}>{children}</ChatModelPickerContext>
}
