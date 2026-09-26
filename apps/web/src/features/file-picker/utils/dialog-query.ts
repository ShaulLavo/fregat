import { queryOptions } from '@tanstack/react-query'

import { filePickerQueryKeys } from '@/features/file-picker/utils/query-keys'

export const filePickerDialogQueryOptions = queryOptions({
  queryKey: filePickerQueryKeys.dialogModule,
  queryFn: () => import('@/components/file-picker-dialog'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
