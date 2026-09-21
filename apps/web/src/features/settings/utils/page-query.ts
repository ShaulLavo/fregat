import { queryOptions } from '@tanstack/react-query'

import { settingsQueryKeys } from '@/features/settings/utils/query-keys'

export const settingsPageQueryOptions = queryOptions({
  queryKey: settingsQueryKeys.pageModule,
  queryFn: () => import('@/features/settings/components/page'),
  staleTime: 'static',
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
