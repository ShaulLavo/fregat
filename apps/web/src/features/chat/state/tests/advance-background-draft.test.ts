import { expect, test } from '../../../../../test/fixtures'
import {
  TEST_ENVIRONMENT_ID,
  TEST_WORKTREE_ID,
  TEST_PROJECT_ID,
} from '../../../../../test/factories/chat'
import { advanceBackgroundDraft } from '../advance-background-draft'
import { useChatInputDraftStore } from '../chat-input-draft-store'
import type { DraftIdentity } from '../../utils/draft-storage'

const target = {
  environmentId: TEST_ENVIRONMENT_ID,
  draftKey: 'background-race',
  rootPath: '/repo',
}
const submitted: DraftIdentity = {
  id: target.draftKey,
  projectId: TEST_PROJECT_ID,
  rootPath: target.rootPath,
  baseWorktreeId: TEST_WORKTREE_ID,
  worktreeTarget: {
    kind: 'new',
    worktreeId: TEST_WORKTREE_ID,
    baseWorktreeId: TEST_WORKTREE_ID,
    baseBranch: 'main',
  },
  createdAt: '2026-09-25T00:00:00.000Z',
}

test('a delayed background acknowledgement preserves the next branch selection', () => {
  const drafts = useChatInputDraftStore.getState()
  const changed = {
    ...submitted,
    worktreeTarget: { ...submitted.worktreeTarget, baseBranch: 'release' },
  }
  drafts.setIdentity(target, changed)
  advanceBackgroundDraft(target, submitted)
  expect(drafts.getDraft(target).identity).toBe(changed)
})

test('an unchanged background draft advances to a fresh worktree', () => {
  const drafts = useChatInputDraftStore.getState()
  drafts.setIdentity(target, submitted)
  advanceBackgroundDraft(target, submitted)
  expect(drafts.getDraft(target).identity?.worktreeTarget.worktreeId).not.toBe(TEST_WORKTREE_ID)
  expect(drafts.getDraft(target).identity?.worktreeTarget).toMatchObject({ baseBranch: 'main' })
})
