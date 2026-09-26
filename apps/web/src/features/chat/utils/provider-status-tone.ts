import type { ProviderSnapshot } from '@workspace/contracts'
import { providerRequiresSignIn } from '@workspace/client-core/chat/providers/auth'
import type { StatusDotTone } from '@workspace/ui/components/status-dot'
import type { ProviderModelDisabledKind } from '@workspace/client-core/chat/providers/models'

// Signing in is the one blocker the user can clear from this panel, so it reads
// as a warning rather than as a failure the row cannot do anything about.
export function modelDisabledTone(kind: ProviderModelDisabledKind): StatusDotTone {
  if (kind === 'sign-in') return 'warning'

  return 'destructive'
}

export function providerTriggerTone(
  provider: ProviderSnapshot | undefined,
  busy: boolean,
): StatusDotTone {
  if (busy) return 'info'
  if (!provider) return 'neutral'
  if (providerRequiresSignIn(provider)) return 'destructive'
  if (provider.status === 'ready') return 'success'
  if (provider.status === 'warning') return 'warning'

  return 'destructive'
}
