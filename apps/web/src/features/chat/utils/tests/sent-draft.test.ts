import { worktreeIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import type { ChatInputDraft } from '@/features/chat/state/chat-input-draft-store'
import { sentDraftStillCurrent } from '@/features/chat/utils/sent-draft'
import { nextWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { expect, test } from '../../../../../test/fixtures'

const worktreeId = (value: string) => v.parse(worktreeIdSchema, value)
const draft = {
  attachments: [],
  prompt: 'Ship it',
  terminalContexts: [],
} as unknown as ChatInputDraft

test('a sent draft is cleared only while nobody changed it', () => {
  expect(sentDraftStillCurrent('sent', draft, draft)).toBe(true)
  expect(sentDraftStillCurrent('sent', { ...draft }, draft)).toBe(false)
  expect(sentDraftStillCurrent('rejected', draft, draft)).toBe(false)
})

test('a background start ignores its own identity change but not new text', () => {
  expect(sentDraftStillCurrent('started', { ...draft, identity: null }, draft)).toBe(true)
  expect(sentDraftStillCurrent('started', { ...draft, prompt: 'Ship it now' }, draft)).toBe(false)
})

test('the next start in new-worktree mode gets a fresh worktree with the same base and branch', () => {
  const target = {
    kind: 'new' as const,
    worktreeId: worktreeId('00000000-0000-4000-8000-000000000001'),
    baseWorktreeId: worktreeId('00000000-0000-4000-8000-000000000002'),
    baseBranch: 'release',
  }

  const next = nextWorktreeTarget(target)

  expect(next).toMatchObject({
    baseBranch: 'release',
    baseWorktreeId: target.baseWorktreeId,
    kind: 'new',
  })
  expect(next.worktreeId).not.toBe(target.worktreeId)
  const current = { kind: 'current' as const, worktreeId: target.baseWorktreeId }
  expect(nextWorktreeTarget(current)).toBe(current)
})
