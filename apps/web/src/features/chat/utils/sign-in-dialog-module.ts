import { queryOptions } from '@tanstack/react-query'

import { providerSignInDialogQueryKeys } from '@/features/chat/utils/query-keys'

/** The provider sign-in dialog is its own chunk: it downloads when it first opens or when the page is idle. */
export const providerSignInDialogModuleQueryOptions = queryOptions({
  queryKey: providerSignInDialogQueryKeys.module,
  queryFn: () => import('@/features/chat/components/provider-sign-in-dialog'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
