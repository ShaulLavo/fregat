import { useChatInputDraftStore, type ChatInputDraftTarget } from './chat-input-draft-store'
import type { DraftIdentity } from '../utils/draft-storage'
import { nextWorktreeTarget } from '../utils/worktree-target'

export function advanceBackgroundDraft(target: ChatInputDraftTarget, submitted: DraftIdentity) {
  const drafts = useChatInputDraftStore.getState()
  if (drafts.getDraft(target).identity !== submitted) return
  drafts.setIdentity(target, {
    ...submitted,
    worktreeTarget: nextWorktreeTarget(submitted.worktreeTarget),
  })
}
