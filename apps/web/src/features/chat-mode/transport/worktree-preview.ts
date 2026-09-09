import {
  worktreeCleanupPreviewSchema,
  worktreeMissingPreviewSchema,
  type ScopedWorktreeRef,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { WorktreeConfirmation } from '@workspace/client-core/chat/worktrees/commands'
import { environmentClientFor } from '@/lib/client'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { unwrapEdenResponse } from '@/lib/eden-events'

export async function worktreeConfirmationPreview(
  ref: ScopedWorktreeRef,
  kind: 'force' | 'missing',
): Promise<WorktreeConfirmation> {
  const client = environmentClientFor(confirmedEnvironmentOrigin(ref.environmentId))
  const query = { worktreeId: ref.worktreeId }
  if (kind === 'force') {
    const response = await client.orchestration['worktree-cleanup-preview'].get({ query })
    const preview = v.parse(
      worktreeCleanupPreviewSchema,
      unwrapEdenResponse(response, {
        requireData: true,
        emptyMessage: 'Cleanup preview was empty.',
      }),
    )
    return { kind, preview }
  }
  const response = await client.orchestration['worktree-missing-preview'].get({ query })
  const preview = v.parse(
    worktreeMissingPreviewSchema,
    unwrapEdenResponse(response, {
      requireData: true,
      emptyMessage: 'Missing-checkout preview was empty.',
    }),
  )
  return { kind, preview }
}
