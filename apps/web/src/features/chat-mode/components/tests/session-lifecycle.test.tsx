import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { useSessionSnoozeRequestStore } from '@/features/chat-mode/state/session-snooze-request-store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'

async function menu(label: string) {
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: label }))
}

test('pin, settle, resume, snooze and unsnooze reach the real owning server', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  const current = async () =>
    (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])!
  await menu('Pin')
  await waitFor(async () => expect((await current()).pinnedAt).not.toBeNull())
  await menu('Mark as settled')
  await waitFor(async () => {
    expect((await current()).settledOverride).toBe('settled')
    expect((await current()).pinnedAt).toBeNull()
  })
  await menu('Move to active')
  await waitFor(async () => expect((await current()).settledOverride).toBe('active'))
  await menu('Snooze…')
  await userEvent.click(screen.getByRole('button', { name: /In 1 hour/ }))
  await waitFor(async () => expect((await current()).snoozedUntil).not.toBeNull())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await menu('Unsnooze')
  await waitFor(async () => expect((await current()).snoozedUntil).toBeNull())
})

test('custom snooze rejects invalid input and persists a duration', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await menu('Snooze…')
  expect(screen.getByRole('button', { name: 'Snooze until chosen time' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Duration' }))
  const amount = screen.getByRole('spinbutton', { name: 'Duration' })
  await userEvent.type(amount, '-1')
  expect(screen.getByRole('button', { name: 'Snooze until chosen time' })).toBeDisabled()
  await userEvent.clear(amount)
  await userEvent.type(amount, '15')
  await userEvent.click(screen.getByRole('button', { name: 'Snooze until chosen time' }))
  await waitFor(async () => expect((await h.refresh()).sessions[0]?.snoozedUntil).not.toBeNull())
})

test('bulk snooze reports skipped archived sessions, retains them selected and Undo changes only successful refs', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  const refs = h.sessionIds.map((sessionId) => ({ environmentId: h.environmentId, sessionId }))
  await menu('Archive')
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.archivedAt,
    ).not.toBeNull(),
  )
  useSessionMultiSelectStore.setState({ refs, anchor: refs[0]! })
  useSessionSnoozeRequestStore.getState().requestSnooze({ refs, title: 'Selected sessions' })
  await userEvent.click(await screen.findByRole('button', { name: /In 1 hour/ }))
  await waitFor(() => expect(useSessionMultiSelectStore.getState().refs).toEqual([refs[0]]))
  const notification = await screen.findByText('1 snoozed, 1 skipped')
  await userEvent.click(
    within(notification.closest('[data-sonner-toast]')!).getByRole('button', { name: 'Undo' }),
  )
  await waitFor(async () =>
    expect((await h.refresh()).sessions.every((session) => session.snoozedUntil === null)).toBe(
      true,
    ),
  )
})

test('unknown owning capabilities hide lifecycle actions', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  useEnvironmentsStore.setState((state) => ({
    entries: Object.fromEntries(
      Object.entries(state.entries).map(([key, entry]) => [
        key,
        {
          ...entry,
          descriptor: entry.descriptor ? { ...entry.descriptor, capabilities: undefined } : null,
        },
      ]),
    ),
  }))
  renderRailHarness(h)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  expect(screen.queryByRole('menuitem', { name: 'Snooze…' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: 'Pin' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: 'Mark as settled' })).toBeNull()
})
