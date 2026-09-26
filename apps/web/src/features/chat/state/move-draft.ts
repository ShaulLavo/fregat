import type { EnvironmentId, ProjectId, WorktreeId } from '@workspace/contracts'

import { createClientInvariantError } from '@/lib/structured-errors'
import type { Navigation } from '@/state/navigation'
import { draftCanChangeMachine } from '../utils/draft-workspace'
import { useChatInputDraftStore, type ChatInputDraftTarget } from './chat-input-draft-store'

export type DraftDestination = {
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId
  readonly worktree: { readonly id: WorktreeId; readonly path: string }
}

/**
 * Re-homes a draft on another worktree or machine: the text goes with it, and the
 * old draft is dropped only once the new one is on screen.
 *
 * Attachments and terminal captures live on the machine that made them, so a move
 * to another machine is refused while the draft holds either; the menu says so.
 */
export async function moveDraft(
  navigation: Navigation,
  from: ChatInputDraftTarget,
  destination: DraftDestination,
) {
  const store = useChatInputDraftStore.getState()
  const draft = store.getDraft(from)
  const sameMachine = destination.environmentId === from.environmentId
  if (!sameMachine && !draftCanChangeMachine(draft)) return false

  const id = crypto.randomUUID()
  const to: ChatInputDraftTarget = {
    environmentId: destination.environmentId,
    draftKey: id,
    rootPath: destination.worktree.path,
  }
  store.setIdentity(to, {
    id,
    projectId: destination.projectId,
    rootPath: destination.worktree.path,
    baseWorktreeId: destination.worktree.id,
    worktreeTarget: { kind: 'current', worktreeId: destination.worktree.id },
    // Agent definitions are files on one machine; another machine starts from its default.
    ...(sameMachine && draft.identity?.agent ? { agent: draft.identity.agent } : {}),
    createdAt: new Date().toISOString(),
  })
  store.restoreContent(to, draft)
  store.setInteractionMode(to, draft.interactionMode)
  store.setRuntimeMode(to, draft.runtimeMode)
  // A model id names a provider instance on this machine; the other one resolves its own default.
  if (sameMachine) store.setModelSelection(to, draft.modelSelection)

  const result = await navigation.openChat({
    environmentId: destination.environmentId,
    projectId: destination.projectId,
    sessionId: null,
    surface: 'main',
    draftId: id,
  })
  if (result.status !== 'applied') {
    store.clearDraft(to)
    if (result.status === 'unavailable') throw createClientInvariantError(result.reason)
    return false
  }
  store.clearDraft(from)
  return true
}
