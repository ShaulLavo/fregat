import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { projectIdSchema, sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  createSessionSelectionStore,
  resetSessionSelectionStore,
} from '@/features/chat-mode/state/session-selection-store'
import { readSessionSelectionCache } from '@/features/workspace/state/cache'
import { expect, test } from '../../../../../test/fixtures'

// A DOM test on purpose: the durability being proved here is localStorage, and the node
// world has none — a store test there would pass while persisting nothing.
const projectId = v.parse(projectIdSchema, '852f9abe-406f-5a75-a09c-18dbfa9fc7f2')
const sessionId = v.parse(sessionIdSchema, '0cecbcf1-b3a4-5425-826e-9780b43b7832')

test('the session on the stage survives a restart', () => {
  resetSessionSelectionStore()

  createSessionSelectionStore(testScopedStorage)
    .getState()
    .selectSession(TEST_ENVIRONMENT_ID, projectId, sessionId)

  expect(readSessionSelectionCache(testScopedStorage)).toEqual({
    kind: 'session',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId,
    sessionId,
  })
  // A second store is what a cold load is: it reads the cache the same way.
  const reloaded = createSessionSelectionStore(testScopedStorage)
  expect(reloaded.getState().selection).toEqual({
    kind: 'session',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId,
    sessionId,
  })
  // And it knows the pick came off disk, so a session that is gone can say so.
  expect(reloaded.getState().restored).toBe(true)
})

test('a draft keeps its identity through persistence and restart', () => {
  resetSessionSelectionStore()

  const store = createSessionSelectionStore(testScopedStorage)
  store.getState().startDraft(TEST_ENVIRONMENT_ID, projectId)

  const draft = store.getState().selection
  expect(draft).toEqual({
    kind: 'draft',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId,
    draftId: expect.stringMatching(/\S/),
  })
  expect(readSessionSelectionCache(testScopedStorage)).toEqual(draft)
  const reloaded = createSessionSelectionStore(testScopedStorage)
  expect(reloaded.getState().selection).toEqual(draft)
  expect(reloaded.getState().restored).toBe(true)
})

test('a cold profile starts on the auto pick', () => {
  resetSessionSelectionStore()

  const store = createSessionSelectionStore(testScopedStorage)

  expect(store.getState().selection).toEqual({ kind: 'auto' })
  expect(store.getState().restored).toBe(false)
})
