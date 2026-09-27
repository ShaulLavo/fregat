import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import {
  undoLatestSessionAction,
  redoLatestSessionAction,
} from '@/features/chat-mode/state/session-undo'
import { useSessionUndoStore } from '@/features/chat-mode/state/session-undo-history'
import { CHAT_SESSION_SCOPE } from '@/features/chat-mode/utils/mutation-keys'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { renderHookWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'

async function menu(label: string, title: string) {
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle(title) })
  await userEvent.click(await screen.findByRole('menuitem', { name: label }))
}

test('a new action dismisses the discarded Redo notice', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await menu('Mark as settled', 'First')
  await act(async () => {
    expect(await undoLatestSessionAction()).toBe(true)
  })
  await screen.findByText('Undid 1 settled')
  await menu('Mark as settled', 'Second')
  expect(useSessionUndoStore.getState().redo).toHaveLength(0)
  await waitFor(() => expect(screen.queryByText('Undid 1 settled')).toBeNull(), { timeout: 800 })
})

test('selecting an older same-row notice preserves newer undo', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  const hook = renderHookWithProviders(() => useSessionActions(), {
    application: h.application,
    queryClient: h.application.getSnapshot().queryClient,
  })
  const ref = { environmentId: h.environmentId, sessionId: h.sessionIds[0]! }
  await act(() =>
    hook.result.current.applyLifecycle(ref, {
      type: 'snooze',
      snoozedUntil: '2099-01-01T00:00:00.000Z',
    }),
  )
  await act(() => hook.result.current.applyLifecycle(ref, { type: 'settle' }))
  expect(useSessionUndoStore.getState().undo).toHaveLength(2)
  const older = (await screen.findByText('1 snoozed')).closest('[data-sonner-toast]')!
  expect(within(older as HTMLElement).getByRole('button', { name: 'Undo' })).toBeDisabled()
  expect((await h.refresh()).sessions.find((s) => s.id === ref.sessionId)?.settledOverride).toBe(
    'settled',
  )
  expect(useSessionUndoStore.getState().undo).toHaveLength(2)
  await act(async () => {
    expect(await undoLatestSessionAction()).toBe(true)
  })
  expect(within(older as HTMLElement).getByRole('button', { name: 'Undo' })).toBeEnabled()
  await userEvent.click(within(older as HTMLElement).getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(useSessionUndoStore.getState().undo).toHaveLength(0))
  expect((await h.refresh()).sessions.find((s) => s.id === ref.sessionId)?.snoozedUntil).toBeNull()
  await act(async () => {
    expect(await redoLatestSessionAction()).toBe(true)
    expect(await redoLatestSessionAction()).toBe(true)
  })
  expect((await h.refresh()).sessions.find((s) => s.id === ref.sessionId)?.settledOverride).toBe(
    'settled',
  )
  expect(screen.queryByText('Session restore failed')).toBeNull()
})

test('two queued Undo requests undo two distinct batches', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await menu('Mark as settled', 'First')
  await menu('Mark as settled', 'Second')
  let release!: () => void
  let started!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const blocker = runMutation(
    primaryQueryClient(),
    {
      scope: { id: CHAT_SESSION_SCOPE },
      mutationFn: () => {
        started()
        return waiting
      },
    },
    undefined,
  )
  await ready
  const first = undoLatestSessionAction()
  const second = undoLatestSessionAction()
  release()
  let results: boolean[] = []
  await act(async () => {
    await blocker
    results = await Promise.all([first, second])
  })
  expect(results).toEqual([true, true])
  expect((await h.refresh()).sessions.every((s) => s.settledOverride === null)).toBe(true)
})

test('claimed Undo survives its notice dismissal while queued', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await menu('Mark as settled', 'First')
  let release!: () => void
  let started!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const blocker = runMutation(
    primaryQueryClient(),
    {
      scope: { id: CHAT_SESSION_SCOPE },
      mutationFn: () => {
        started()
        return waiting
      },
    },
    undefined,
  )
  await ready
  const pending = undoLatestSessionAction()
  await waitFor(() => expect(screen.queryByText('1 settled')).toBeNull())
  expect(useSessionUndoStore.getState().undo).toHaveLength(1)
  release()
  await act(async () => {
    await blocker
    expect(await pending).toBe(true)
  })
  expect(
    (await h.refresh()).sessions.find((s) => s.id === h.sessionIds[0])?.settledOverride,
  ).toBeNull()
})
