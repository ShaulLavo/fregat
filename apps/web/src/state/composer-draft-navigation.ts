import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'

import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import type { ComposerDestination } from '@/lib/composer-attach/providers/context'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import type { createChatNavigation } from '@/state/navigation-chat'
import type { createNavigationCoordinator } from '@/state/navigation-coordinator'

export function createComposerDraftNavigation(
  coordinator: Pick<ReturnType<typeof createNavigationCoordinator>, 'getApplication'>,
  openChat: ReturnType<typeof createChatNavigation>,
) {
  return async (destination: ComposerDestination, text: string) => {
    const application = coordinator.getApplication()
    if (!application) return false
    const slice = selectChatProjectionSlice(
      useChatProjectionStore.getState(),
      destination.environmentId,
    )
    const worktree = selectWorktreeAtPath(slice, destination.rootPath)
    if (!worktree) return false
    const draftId = crypto.randomUUID()
    const target = { ...destination, draftKey: draftId }
    const drafts = useChatInputDraftStore.getState()
    drafts.setIdentity(target, {
      id: draftId,
      projectId: worktree.projectId,
      rootPath: destination.rootPath,
      baseWorktreeId: worktree.id,
      worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      createdAt: new Date().toISOString(),
    })
    drafts.setPrompt(target, text)
    const active = application.getSnapshot()
    const workspace = active.editor.workspaceStore.getState()
    const sidebar =
      confirmedEnvironmentId(active.origin) === destination.environmentId &&
      workspace.rootFolder?.path === destination.rootPath &&
      workspace.uiMode === 'workbench'
    try {
      const result = await openChat({
        environmentId: destination.environmentId,
        projectId: worktree.projectId,
        worktreeId: worktree.id,
        sessionId: null,
        draftId,
        surface: sidebar ? 'sidebar' : 'main',
      })
      if (result.status !== 'applied') {
        useChatInputDraftStore.getState().clearDraft(target)
        return false
      }
      return true
    } catch (error) {
      useChatInputDraftStore.getState().clearDraft(target)
      throw error
    }
  }
}
