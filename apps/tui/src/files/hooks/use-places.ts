import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { ChatOwner } from '@workspace/client-core/chat/owner'

import { currentWorktree } from '@/agent/utils/selection'
import type { FilePlace } from '@/files/utils/view'

/** Each project's current worktree, as a place the file picker can jump to. */
export function usePlaces(chat: ChatOwner): readonly FilePlace[] {
  // Session events leave these references alone, so streaming replies do not re-render the caller.
  const projection = useStore(
    chat.store,
    useShallow(({ projection }) => ({
      projectIds: projection.projectIds,
      projectById: projection.projectById,
      worktreeIds: projection.worktreeIds,
      worktreeById: projection.worktreeById,
    })),
  )
  return projection.projectIds.flatMap((id) => {
    const project = projection.projectById[id]
    const worktree = currentWorktree(projection, id)
    return worktree ? [{ name: project.title, path: worktree.path }] : []
  })
}
