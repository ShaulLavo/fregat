import { queryOptions } from '@tanstack/react-query'

import { paletteQueryKeys } from '@/features/command-palette/utils/query-keys'

export const paletteContentQueryOptions = queryOptions({
  queryKey: paletteQueryKeys.contentModule,
  queryFn: () => import('@/features/command-palette/components/content'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
