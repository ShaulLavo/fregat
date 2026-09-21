import { queryOptions } from '@tanstack/react-query'

import { terminalQueryKeys } from '@/features/terminal/utils/query-keys'

export const terminalPanelQueryOptions = queryOptions({
  queryKey: terminalQueryKeys.panelModule,
  queryFn: () => import('@/features/terminal/components/panel'),
  staleTime: 'static',
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
