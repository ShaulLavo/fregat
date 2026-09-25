import { commandIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'
import { holdToConfirm } from '../../../../../test/hold'

test('renames through the real owning server', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
  const input = screen.getByRole('textbox', { name: 'Session title' })
  await userEvent.clear(input)
  await userEvent.type(input, 'Renamed{Enter}')
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.title,
    ).toBe('Renamed'),
  )
})
test('Escape cancels rename and sends no title update', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
  const input = screen.getByRole('textbox', { name: 'Session title' })
  await userEvent.clear(input)
  await userEvent.type(input, 'Discarded{Escape}')
  expect(
    (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.title,
  ).toBe('First')
})
test('archive persists and releases only the selected scoped session', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  useSessionSelectionStore.getState().selectSession(h.environmentId, h.projectId, h.sessionIds[0]!)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.archivedAt,
    ).not.toBeNull(),
  )
  expect(useSessionSelectionStore.getState().selection).toMatchObject({
    environmentId: h.environmentId,
    kind: 'draft',
    projectId: h.projectId,
  })
})
test('delete requires confirmation and cancellation leaves the real session intact', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect((await h.refresh()).sessions).toHaveLength(2)
})
test('confirmed delete removes the session through its owner', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  holdToConfirm(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(async () =>
    expect((await h.refresh()).sessions.some((session) => session.id === h.sessionIds[0])).toBe(
      false,
    ),
  )
})

test('timer wake appears at its deadline and acknowledgment retains server snooze', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const sessionId = h.sessionIds[0]!
  const deadline = new Date(Date.now() + 200).toISOString()
  await h.dispatch({
    type: 'session.snooze',
    sessionId,
    snoozedUntil: deadline,
    commandId: v.parse(commandIdSchema, 'snooze-wake-ui'),
  })
  await h.refresh()
  renderRailHarness(h)
  await screen.findByText('Woke')
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Acknowledge wake' }))
  await waitFor(() => expect(screen.queryByText('Woke')).toBeNull())
  expect(
    (await h.refresh()).sessions.find((session) => session.id === sessionId)?.snoozedUntil,
  ).toBe(deadline)
})
