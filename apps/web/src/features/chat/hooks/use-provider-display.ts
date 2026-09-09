import { useQuery } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'
import { useEffect } from 'react'

import {
  readProviderDisplayCache,
  writeProviderDisplayCache,
} from '@/features/chat/state/provider-display-cache'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'

export function useProviderDisplay(providerInstanceId: ProviderInstanceId | undefined) {
  const environmentId = useEnvironmentId()
  const { data } = useQuery(providerListQueryOptions())

  useEffect(() => {
    if (!data) return
    writeProviderDisplayCache(environmentScopedStorage(environmentId), data.providers)
  }, [data, environmentId])

  const provider = data?.providers.find(
    (candidate) => candidate.providerInstanceId === providerInstanceId,
  )
  const displays =
    data?.providers ?? readProviderDisplayCache(environmentScopedStorage(environmentId))
  const display = displays.find((candidate) => candidate.providerInstanceId === providerInstanceId)

  return { provider, display }
}
