import { queryOptions } from '@tanstack/react-query'

import { pickerDialogQueryKeys } from '@/features/environments/utils/query-keys'

/** The machine picker is its own chunk: it downloads when it first opens or when the page is idle. */
export const pickerDialogModuleQueryOptions = queryOptions({
  queryKey: pickerDialogQueryKeys.module,
  queryFn: () => import('@/features/environments/components/picker-dialog'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
