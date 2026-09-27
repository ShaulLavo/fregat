import { queryOptions } from '@tanstack/react-query'

import { logsKeys } from '@/features/logs/utils/query-keys'

export const logsPanelQueryOptions = queryOptions({
  queryKey: logsKeys.panelModule,
  queryFn: () => import('@/features/logs/components/panel'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
