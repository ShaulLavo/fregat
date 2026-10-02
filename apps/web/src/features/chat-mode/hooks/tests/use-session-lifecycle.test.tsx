import { createSessionLifecycleCommand } from '@workspace/client-core/chat/commands'
import { act } from '@testing-library/react'
import { createClientError } from '@workspace/client-core/errors'
import type { ScopedSessionRef, SessionId } from '@workspace/contracts'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { sessionUndoHistory } from '@/features/chat-mode/state/session-undo-history'
import { undoLatestSessionAction } from '@/features/chat-mode/state/session-undo'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { createObservedInProcessClient } from '../../../../../test/client'
import { renderHookWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'

test('partial bulk snooze clears selection before every command and Undo includes successful rows only', async ({
  server,
}) => {
  let failedId: SessionId | undefined
  const selectionsDuringRequests: (readonly ScopedSessionRef[])[] = []
  const client = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/commands')) return
    const body = await request.clone().json()
    if (body.type !== 'session.snooze') return
    selectionsDuringRequests.push(useSessionMultiSelectStore.getState().refs)
    if (body.sessionId !== failedId) return
    throw createClientError({
      code: 'TEST_NETWORK_FAILURE',
      message: 'Injected snooze network failure',
      status: 503,
      why: 'The test interrupts one transport request.',
      fix: 'Retry the failed snooze.',
    })
  })
  const harness = await createRailHarness(client, server, ['First', 'Middle', 'Last'])
  failedId = harness.sessionIds[1]
  const refs = harness.sessionIds.map((sessionId) => ({
    environmentId: harness.environmentId,
    sessionId,
  }))
  useSessionMultiSelectStore.setState({ refs, anchor: refs[0] })
  const hook = renderHookWithProviders(() => useSessionActions(), {
    application: harness.application,
    queryClient: harness.application.getSnapshot().queryClient,
  })
  await act(async () => {
    const result = await hook.result.current.applyLifecycleToSessions(refs, {
      type: 'snooze',
      snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(result.succeeded).toEqual([refs[0], refs[2]])
    expect(result.failed).toBe(1)
  })
  expect(selectionsDuringRequests).toEqual([[], [], []])
  expect(useSessionMultiSelectStore.getState().refs).toEqual([])
  expect(
    sessionUndoHistory
      .getSnapshot()
      .undo.at(-1)
      ?.entries.map((entry) => entry.ref),
  ).toEqual([refs[0], refs[2]])
  expect(
    (await harness.refresh()).sessions
      .filter((session) => session.snoozedUntil)
      .map((session) => session.id),
  ).toEqual([harness.sessionIds[0], harness.sessionIds[2]])
  await act(async () => {
    await undoLatestSessionAction()
  })
  expect((await harness.refresh()).sessions.every((session) => session.snoozedUntil === null)).toBe(
    true,
  )
})

test('repeated settle commands preserve the first settled timestamp and placement', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server, ['Only'])
  const command = createSessionLifecycleCommand(h.sessionIds[0]!, { type: 'settle' })
  const firstReceipt = await h.dispatch(command)
  const first = (await h.refresh()).sessions[0]!
  const replayReceipt = await h.dispatch(command)
  const nextReceipt = await h.dispatch(
    createSessionLifecycleCommand(h.sessionIds[0]!, { type: 'settle' }),
  )
  const settled = (await h.refresh()).sessions[0]!
  expect(replayReceipt).toEqual({ ...firstReceipt, deduped: true })
  expect(nextReceipt.deduped).toBe(false)
  expect(first.settledAt).not.toBeNull()
  expect(settled.settledAt).toBe(first.settledAt)
  expect(settled.settledOverride).toBe('settled')
  expect(settled.pinnedAt).toBeNull()
  expect(settled.snoozedUntil).toBeNull()
})
