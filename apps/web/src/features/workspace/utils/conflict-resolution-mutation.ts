import type { MutationOptions } from '@tanstack/react-query'

import {
  workspaceConflictScope,
  workspaceMutationKeys,
} from '@/features/workspace/utils/mutation-keys'
import { notifyMutationError } from '@/features/workspace/utils/notify-mutation-error'

export type ConflictResolutionSource = 'editor' | 'local' | 'remote'

export function conflictResolutionMutationOptions<TData>(
  conflictId: string,
  mutationFn: (source: ConflictResolutionSource) => Promise<TData>,
): MutationOptions<TData, unknown, ConflictResolutionSource> {
  return {
    mutationFn,
    mutationKey: workspaceMutationKeys.resolveConflict(conflictId),
    onError: notifyMutationError,
    scope: { id: workspaceConflictScope(conflictId) },
  }
}
