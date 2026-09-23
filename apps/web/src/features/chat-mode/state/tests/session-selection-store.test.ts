import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { projectIdSchema, sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  resetSessionSelectionStore,
  useSessionSelectionStore,
} from '@/features/chat-mode/state/session-selection-store'
import { expect, test } from '../../../../../test/fixtures'

const projectA = v.parse(projectIdSchema, '852f9abe-406f-5a75-a09c-18dbfa9fc7f2')
const projectB = v.parse(projectIdSchema, '2dc9c99b-2649-5eab-9e90-942464bb1db3')
const sessionA = v.parse(sessionIdSchema, '0cecbcf1-b3a4-5425-826e-9780b43b7832')
const sessionB = v.parse(sessionIdSchema, 'ea35feb3-d322-5206-93b3-fad28939a07d')
const sessionC = v.parse(sessionIdSchema, '30886e00-b5c5-5564-8ba1-1431a307f361')
// Rail order: newest first.
const railOrder = [sessionA, sessionB, sessionC]

function reset() {
  resetSessionSelectionStore()

  return useSessionSelectionStore.getState()
}

test('a pick made in this session is not a restored one', () => {
  const store = reset()

  store.selectSession(TEST_ENVIRONMENT_ID, projectA, sessionA)

  expect(useSessionSelectionStore.getState().restored).toBe(false)
})

test('a session pick records both the project and the session', () => {
  const store = reset()

  store.selectSession(TEST_ENVIRONMENT_ID, projectB, sessionB)

  expect(useSessionSelectionStore.getState().selection).toEqual({
    kind: 'session',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: projectB,
    sessionId: sessionB,
  })
})

test('a new-session request creates a distinct draft in the requested project', () => {
  const store = reset()
  store.selectSession(TEST_ENVIRONMENT_ID, projectA, sessionB)

  store.startDraft(TEST_ENVIRONMENT_ID, projectB)

  const firstDraft = useSessionSelectionStore.getState().selection
  expect(firstDraft).toEqual({
    kind: 'draft',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: projectB,
    draftId: expect.stringMatching(/\S/),
  })
  store.startDraft(TEST_ENVIRONMENT_ID, projectB)
  const secondDraft = useSessionSelectionStore.getState().selection
  expect(secondDraft).toEqual({
    kind: 'draft',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: projectB,
    draftId: expect.stringMatching(/\S/),
  })
  expect(secondDraft).not.toEqual(firstDraft)
})

test('releasing the session on stage lands on the row below it', () => {
  const store = reset()
  store.selectSession(TEST_ENVIRONMENT_ID, projectA, sessionB)

  store.releaseSession({ environmentId: TEST_ENVIRONMENT_ID, sessionId: sessionB }, railOrder)

  expect(useSessionSelectionStore.getState().selection).toEqual({
    kind: 'session',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: projectA,
    sessionId: sessionC,
  })
})

test('releasing the last session falls back to the row above it', () => {
  const store = reset()
  store.selectSession(TEST_ENVIRONMENT_ID, projectA, sessionC)

  store.releaseSession({ environmentId: TEST_ENVIRONMENT_ID, sessionId: sessionC }, railOrder)

  expect(useSessionSelectionStore.getState().selection).toEqual({
    kind: 'session',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: projectA,
    sessionId: sessionB,
  })
})

test('releasing the only session leaves the stage on the auto pick', () => {
  const store = reset()
  store.selectSession(TEST_ENVIRONMENT_ID, projectA, sessionA)

  store.releaseSession({ environmentId: TEST_ENVIRONMENT_ID, sessionId: sessionA }, [sessionA])

  expect(useSessionSelectionStore.getState().selection).toEqual({ kind: 'auto' })
})

test('releasing some other session leaves the pick alone', () => {
  const store = reset()
  store.selectSession(TEST_ENVIRONMENT_ID, projectA, sessionB)

  store.releaseSession({ environmentId: TEST_ENVIRONMENT_ID, sessionId: sessionA }, railOrder)

  expect(useSessionSelectionStore.getState().selection).toEqual({
    kind: 'session',
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: projectA,
    sessionId: sessionB,
  })
})
