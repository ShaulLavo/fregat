import * as v from 'valibot'
import { worktreeIdSchema } from '@workspace/contracts'
import { queuePrompt, readInbox } from '@/agent-stage/state/inbox'
import { test, expect } from '../../../test/fixtures'

const worktreeId = v.parse(worktreeIdSchema, 'aaaa1111-bbbb-4ccc-8ddd-eeeeffff2222')
const context = { source: 'terminal', lineStart: 1, lineEnd: 1, text: 'Build failed' }

test.for(['{', '{}', '', '[3]'])(
  'deletes corrupt inbox state and warns once: %s',
  (raw, { storage, storageWarnings }) => {
    const key = `agent.inbox.worktree:${worktreeId}`
    storage.setItem(key, raw)
    expect(readInbox(storage, worktreeId)).toEqual([])
    expect(storage.getItem(key)).toBeNull()
    expect(readInbox(storage, worktreeId)).toEqual([])
    expect(storageWarnings).toMatchObject([{ level: 'warn', storageKey: key }])
  },
)

test.for(['{', '{}', '', '[3]'])(
  'queues new context after discarding corrupt inbox state: %s',
  (raw, { storage, storageWarnings }) => {
    const key = `agent.inbox.worktree:${worktreeId}`
    storage.setItem(key, raw)
    queuePrompt(storage, worktreeId, context)
    expect(readInbox(storage, worktreeId)).toEqual([context])
    queuePrompt(storage, worktreeId, { ...context, text: 'Second context' })
    expect(readInbox(storage, worktreeId)).toEqual([
      context,
      { ...context, text: 'Second context' },
    ])
    expect(storageWarnings).toMatchObject([{ level: 'warn', storageKey: key }])
  },
)

test('absent inbox state is silent and queued context persists', ({ storage, storageWarnings }) => {
  expect(readInbox(storage, worktreeId)).toEqual([])
  queuePrompt(storage, worktreeId, context)
  expect(readInbox(storage, worktreeId)).toEqual([context])
  expect(storageWarnings).toEqual([])
})
