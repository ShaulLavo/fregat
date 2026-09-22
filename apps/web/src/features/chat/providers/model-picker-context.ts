import type { ModelSelection, ProviderInstanceId, ProviderSnapshot } from '@workspace/contracts'
import { createContext } from 'react'

import type { ProviderModelOption } from '@workspace/client-core/chat/providers/models'

export type ChatModelPicker = {
  /** Existing sessions can change models, but must keep their provider. */
  readonly sessionProviderInstanceId: ProviderInstanceId | null
  /** The selection the composer will send with the next turn, or null when no provider offers one. */
  readonly modelSelection: ModelSelection | null
  readonly provider: ProviderSnapshot | undefined
  /** Takes the picker row, not a bare selection, so the level can be reconciled against the new model. */
  readonly selectModel: (option: ProviderModelOption) => void
}

export const ChatModelPickerContext = createContext<ChatModelPicker | null>(null)
