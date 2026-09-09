import type { ModelSelection, ProviderSnapshot } from '@workspace/contracts'

import { reconcileModelEffort } from '@workspace/client-core/chat/providers/effort'
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
  // The stored reasoning level rides along, but only if the model still
  // advertises it: a catalog that dropped a level must not keep sending it.
  if (kept) return reconcileModelEffort(stored, kept.modelSelection, kept)

  // A different model entirely, so the stored level belonged to something else.
  return options.find((option) => !option.disabledReason)?.modelSelection ?? null
}
