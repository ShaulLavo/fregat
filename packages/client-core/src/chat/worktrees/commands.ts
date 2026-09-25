import {
  commandIdSchema,
  type ClientOrchestrationCommand,
  type WorktreeCleanupPreview,
  type WorktreeMissingPreview,
  type WorktreeId,
} from '@workspace/contracts'
import * as v from 'valibot'

export type WorktreeAction =
  | 'worktree.cleanup'
  | 'worktree.retry'
  | 'worktree.retain'
  | 'worktree.adopt'
  | 'worktree.release'
export type WorktreeConfirmation =
  | { readonly kind: 'force'; readonly preview: WorktreeCleanupPreview }
  | { readonly kind: 'missing'; readonly preview: WorktreeMissingPreview }
  | { readonly kind: 'release' }

export function worktreeActionCommand(
  type: WorktreeAction,
  worktreeId: WorktreeId,
): ClientOrchestrationCommand {
  return { type, worktreeId, commandId: v.parse(commandIdSchema, crypto.randomUUID()) }
}

export function confirmedWorktreeCommand(
  worktreeId: WorktreeId,
  confirmation: WorktreeConfirmation,
): ClientOrchestrationCommand {
  const commandId = v.parse(commandIdSchema, crypto.randomUUID())
  if (confirmation.kind === 'force')
    return {
      type: 'worktree.force-cleanup',
      commandId,
      worktreeId,
      authorization: confirmation.preview.authorization,
    }
  if (confirmation.kind === 'missing')
    return {
      type: 'worktree.resolve-missing',
      commandId,
      worktreeId,
      authorization: confirmation.preview.authorization,
    }
  return { type: 'worktree.release', commandId, worktreeId }
}
