import { queryOptions } from '@tanstack/react-query'

import { onboardingQueryKeys } from '@/features/onboarding/utils/query-keys'

/** The first-workspace flow is its own chunk: only a window with no folder open downloads it. */
export const firstWorkspaceModuleQueryOptions = queryOptions({
  queryKey: onboardingQueryKeys.module,
  queryFn: () => import('@/features/onboarding/components/first-workspace'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  // The browser may already have the chunk while offline.
  networkMode: 'always',
})
