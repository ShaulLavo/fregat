import type { EnvironmentId } from '@workspace/contracts'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { hydrateChatInputDraftStoreFromStorage } from '@/features/chat/state/chat-input-draft-store'
import { hydrateChatChangedFilesExpansionStoreFromStorage } from '@/features/chat/state/chat-changed-files-expansion-store'
import { hydrateSessionDiffScopeStoreFromStorage } from '@/features/chat/state/session-diff-scope-store'
import { initializePromptStashStore } from '@/features/chat/state/prompt-stash-store'
import { hydrateSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { hydrateSessionRailCollapse } from '@/features/chat-mode/state/session-rail-store'
import { initializeSessionSelectionStorage } from '@/features/chat-mode/state/session-selection-store'

const initialized = new Set<EnvironmentId>()

export function initializeEnvironmentPersistence(storage: ScopedStorage) {
  if (initialized.has(storage.environmentId)) return
  hydrateChatInputDraftStoreFromStorage(storage)
  hydrateChatChangedFilesExpansionStoreFromStorage(storage)
  hydrateSessionDiffScopeStoreFromStorage(storage)
  initializePromptStashStore(storage)
  hydrateSessionReadStore(storage)
  hydrateSessionRailCollapse(storage)
  initializeSessionSelectionStorage(storage)
  initialized.add(storage.environmentId)
}
