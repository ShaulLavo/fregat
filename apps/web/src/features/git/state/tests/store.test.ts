import { createGitStore } from '@/features/git/state/store'
import { expect, test } from '../../../../../test/fixtures'

function memoryDraft(initial = '') {
  let stored = initial
  return {
    read: () => stored,
    stored: () => stored,
    write: (message: string) => (stored = message),
  }
}

test('a new store starts from the stored commit message', () => {
  const store = createGitStore(memoryDraft('fix: half typed'))

  expect(store.getState().commitMessage).toBe('fix: half typed')
})

test('typing, generating and resetting all reach the stored draft', () => {
  const draft = memoryDraft()
  const store = createGitStore(draft)

  store.getState().setCommitMessage('feat: typed')
  expect(draft.stored()).toBe('feat: typed')

  const { commitMessageRevision } = store.getState()
  store.getState().applyGeneratedCommitMessage('feat: generated', commitMessageRevision)
  expect(draft.stored()).toBe('feat: generated')

  store.getState().resetCommitMessage()
  expect(draft.stored()).toBe('')
})
