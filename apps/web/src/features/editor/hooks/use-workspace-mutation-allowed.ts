import { emptySubscription } from '@workspace/utils/subscriptions'
import { useSyncExternalStore } from 'react'

import { useOptionalWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'

const mutationAllowedWithoutService = () => true

export function useWorkspaceMutationAllowed(): boolean {
  const service = useOptionalWorkspaceEditService()
  return useSyncExternalStore(
    service?.subscribe ?? emptySubscription,
    service ? service.canMutateWorkspace : mutationAllowedWithoutService,
    service ? service.canMutateWorkspace : mutationAllowedWithoutService,
  )
}
