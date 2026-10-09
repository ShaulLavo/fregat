import { queryOptions } from '@tanstack/react-query'

import { overlayQueryKeys } from '@/components/utils/query-keys'
import { providerSignInDialogModuleQueryOptions } from '@/features/chat/utils/sign-in-dialog-module'
import { pickerDialogModuleQueryOptions } from '@/features/environments/utils/picker-dialog-module'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

// The browser may already have a chunk while offline, so these load without a network check.
export const sessionDialogsModuleQueryOptions = queryOptions({
  queryKey: overlayQueryKeys.sessionDialogs,
  queryFn: () => import('@/components/session-dialogs'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  networkMode: 'always',
})

export const themeStudioSlotModuleQueryOptions = queryOptions({
  queryKey: overlayQueryKeys.themeStudioSlot,
  queryFn: () => import('@/components/theme-studio-slot'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  networkMode: 'always',
})

/** Loads every deferred overlay's code ahead of its first open. A failed load retries on open. */
export function warmDeferredOverlays() {
  for (const load of [
    () => resourceQueryClient.query(sessionDialogsModuleQueryOptions),
    () => resourceQueryClient.query(themeStudioSlotModuleQueryOptions),
    () => resourceQueryClient.query(pickerDialogModuleQueryOptions),
    () => resourceQueryClient.query(providerSignInDialogModuleQueryOptions),
  ])
    void load().catch(() => undefined)
}
