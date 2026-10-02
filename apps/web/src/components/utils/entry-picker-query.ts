import { queryOptions } from '@tanstack/react-query'
import { entryPickerQueryKeys } from '@/components/utils/query-keys'

export const entryPickerModuleQueryOptions = queryOptions({
  queryKey: entryPickerQueryKeys.module,
  queryFn: () => import('@/components/entry-picker'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
