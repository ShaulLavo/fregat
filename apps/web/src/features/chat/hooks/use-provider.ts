import { useQuery } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'

import { providerListQueryOptions } from '@/features/chat/utils/provider-query'

export function useProvider(providerInstanceId: ProviderInstanceId | undefined) {
  const { data } = useQuery(providerListQueryOptions())

  return data?.providers.find((candidate) => candidate.providerInstanceId === providerInstanceId)
}
