import type { ModelSelection, ProviderSnapshot } from '@workspace/contracts'

import { reconcileModelOptions } from '@workspace/client-core/chat/providers/options'
import {
  providerModelOptions,
  providerModelSelectionKey,
} from '@workspace/client-core/chat/providers/models'

/**
 * Resolves the model a new session should start on, against the providers that are
 * actually installed and ready. Reuses the picker's own readiness verdict so the
 * resolver and the picker rows can never disagree.
 *
 * A stored preference pointing at a provider that is merely broken right now is
 * resolved around for this session, never rewritten — reinstalling the provider
 * restores a genuine choice instead of silently inheriting the fallback.
 */
export function resolveChatModelSelection(
  providers: readonly ProviderSnapshot[] | undefined,
  stored: ModelSelection | null,
): ModelSelection | null {
  const options = providerModelOptions(providers)
  if (options.length === 0) return null

  const storedKey = stored ? providerModelSelectionKey(stored) : null
  const kept = options.find((option) => option.key === storedKey && !option.disabledReason)
  if (kept) return reconcileModelOptions(stored, kept.modelSelection, kept.optionDescriptors)

  // A different model entirely, so the stored level belonged to something else.
  return options.find((option) => !option.disabledReason)?.modelSelection ?? null
}
