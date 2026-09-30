import { worktreeIdSchema, type WorktreeId } from '@workspace/contracts'
import * as v from 'valibot'

export const workspaceLocationSchema = v.variant('kind', [
  v.object({ kind: v.literal('folder'), rootPath: v.string() }),
  v.object({ kind: v.literal('worktree'), rootPath: v.string(), worktreeId: worktreeIdSchema }),
])

export type WorkspaceLocation = v.InferOutput<typeof workspaceLocationSchema>
export type WorktreeIdsByRootPath = Readonly<Record<string, WorktreeId>>

export function workspaceLocation(
  rootPath: string,
  worktreeId: WorktreeId | null,
): WorkspaceLocation {
  if (worktreeId) return { kind: 'worktree', rootPath, worktreeId }
  return { kind: 'folder', rootPath }
}

export function locationWorktreeId(location: WorkspaceLocation) {
  return location.kind === 'worktree' ? location.worktreeId : null
}

export function workspaceLocationId(rootPath: string, worktreeId: WorktreeId | null) {
  if (worktreeId) return `worktree:${worktreeId}`
  return `folder:${rootPath}`
}
