import { createResourceQueryClient } from '@/lib/resources/state/query-client'
import { createMemoryHistory } from '@tanstack/react-router'
import { formatAddress, emptyAddress } from '@workspace/client-core/address/grammar'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { addressEnvironments } from '@/features/address/utils/environments'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createNavigation } from '@/state/navigation'
import { createApplicationRouter } from '@/state/router'
import { captureAddress } from '@/state/navigation-capture'
import type { ApplicationRuntime } from '@/state/application-runtime'

export function createTestNavigation({
  application,
  initialEntries,
  initialIndex,
}: {
  readonly application?: ApplicationRuntime
  readonly initialEntries?: string[]
  readonly initialIndex?: number
} = {}) {
  const entries = initialEntries ?? [
    application ? formatAddress(captureAddress(application, emptyAddress())) : '/',
  ]
  const history = createMemoryHistory({ initialEntries: entries, initialIndex })
  const initial = parseAddressIntent(
    history.location.href,
    addressEnvironments(useEnvironmentsStore.getState().entries),
  )
  return createNavigation(
    createApplicationRouter({ resources: createResourceQueryClient(), history }),
    initial,
  )
}
