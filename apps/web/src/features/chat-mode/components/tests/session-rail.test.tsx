import { orchestrationForApp } from 'server/testing'
import { orchestrationCommandSchema } from '@workspace/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { commandIdSchema, scopedSessionKey } from '@workspace/contracts'
import * as v from 'valibot'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'

test('renders four lifecycle sections and each session once', async ({ client, server }) => {
  const harness = await createRailHarness(client, server)
  renderRailHarness(harness)
  for (const name of ['Pinned', 'Active', 'Snoozed', 'Settled'])
    expect(screen.getByRole('region', { name })).toBeVisible()
  expect(within(screen.getByRole('region', { name: 'Active' })).getByTitle('First')).toBeVisible()
  expect(screen.getAllByTitle('First')).toHaveLength(1)
})
test('opens the owning worktree before publishing the scoped session selection', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  renderRailHarness(harness)
  await userEvent.click(screen.getByTitle('Second'))
  await waitFor(() =>
    expect(useSessionSelectionStore.getState().selection).toMatchObject({
      kind: 'session',
      environmentId: harness.environmentId,
      projectId: harness.projectId,
      sessionId: harness.sessionIds[1],
    }),
  )
  expect(harness.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
    harness.context.worktree!.path,
  )
})
test('range selection holds scoped references and Escape clears it', async ({ client, server }) => {
  const harness = await createRailHarness(client, server)
  renderRailHarness(harness)
  const user = userEvent.setup()
  await user.keyboard('{Control>}')
  await user.click(screen.getByTitle('First'))
  await user.click(screen.getByTitle('Second'))
  await user.keyboard('{/Control}')
  expect(useSessionMultiSelectStore.getState().refs.map(scopedSessionKey)).toEqual(
    harness.sessionIds.map((sessionId) =>
      scopedSessionKey({ environmentId: harness.environmentId, sessionId }),
    ),
  )
  await user.keyboard('{Escape}')
  expect(useSessionMultiSelectStore.getState().refs).toEqual([])
})
test('search narrows the rail without replacing the attention section', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  renderRailHarness(harness)
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'Second')
  expect(screen.getByTitle('Second')).toBeVisible()
  expect(screen.queryByTitle('First')).toBeNull()
})

test('the archive browser unarchives through the owner and returns the session to the inbox', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  await harness.dispatch({
    type: 'session.archive',
    commandId: v.parse(commandIdSchema, 'archive-first'),
    sessionId: harness.sessionIds[0]!,
  })
  await harness.refresh()
  renderRailHarness(harness)
  expect(screen.queryByTitle('First')).toBeNull()
  expect(screen.getByRole('button', { name: 'Archived sessions' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  expect(screen.getByTitle('First')).toBeVisible()
  expect(screen.queryByTitle('Second')).toBeNull()
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: /^Unarchive$/ }))
  await waitFor(async () =>
    expect(
      (await harness.refresh()).sessions.find((session) => session.id === harness.sessionIds[0])
        ?.archivedAt,
    ).toBeNull(),
  )
  expect(screen.getByText('No archived sessions.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Archived sessions' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  expect(screen.getByTitle('First')).toBeVisible()
  expect(screen.getByTitle('Second')).toBeVisible()
})

test('an archived session opens its owning worktree and retains the scoped selection', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  const sessionId = harness.sessionIds[1]!
  await harness.dispatch({
    type: 'session.archive',
    commandId: v.parse(commandIdSchema, 'archive-second'),
    sessionId,
  })
  await harness.refresh()
  renderRailHarness(harness)
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  await userEvent.click(screen.getByTitle('Second'))
  await waitFor(() =>
    expect(useSessionSelectionStore.getState().selection).toEqual({
      kind: 'session',
      environmentId: harness.environmentId,
      projectId: harness.projectId,
      sessionId,
    }),
  )
  expect(harness.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
    harness.context.worktree!.path,
  )
  expect(
    (await harness.refresh()).sessions.find((session) => session.id === sessionId)?.archivedAt,
  ).not.toBeNull()
})

test('an empty archive reports its own empty state and toggles back to active sessions', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  renderRailHarness(harness)
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  expect(screen.getByText('No archived sessions.')).toBeVisible()
  expect(screen.queryByText('No sessions yet.')).toBeNull()
  for (const name of ['Pinned', 'Active', 'Snoozed', 'Settled'])
    expect(screen.getByRole('region', { name })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  expect(screen.queryByText('No archived sessions.')).toBeNull()
  expect(screen.getByTitle('First')).toBeVisible()
})

test('archive search filters filed sessions without exposing matching active sessions', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server, [
    'Filed match',
    'Other filed',
    'Active match',
  ])
  for (const sessionId of harness.sessionIds.slice(0, 2))
    await harness.dispatch({
      type: 'session.archive',
      commandId: v.parse(commandIdSchema, `archive-${sessionId}`),
      sessionId,
    })
  await harness.refresh()
  renderRailHarness(harness)
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'match')
  expect(screen.getByTitle('Filed match')).toBeVisible()
  expect(screen.queryByTitle('Other filed')).toBeNull()
  expect(screen.queryByTitle('Active match')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByTitle('Other filed')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Archived sessions' })).toBeVisible()
})

test('a collapsed project preserves the staged session and restores its hidden sibling', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  renderRailHarness(harness)
  const project = screen.getByRole('option', { name: /Rail project/ })
  await userEvent.click(project)
  expect(project).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByTitle('First')).toBeVisible()
  expect(screen.queryByTitle('Second')).toBeNull()
  expect(screen.getByText('1 hidden')).toBeVisible()
  await userEvent.click(project)
  expect(screen.getByTitle('Second')).toBeVisible()
})

test('shift selection includes intervening scoped rows and archives the whole selection', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server, ['First', 'Middle', 'Last'])
  renderRailHarness(harness)
  const user = userEvent.setup()
  await user.click(screen.getByTitle('First'))
  await user.keyboard('{Shift>}')
  await user.click(screen.getByTitle('Last'))
  await user.keyboard('{/Shift}')
  expect(useSessionMultiSelectStore.getState().refs.map(scopedSessionKey).toSorted()).toEqual(
    harness.sessionIds
      .map((sessionId) => scopedSessionKey({ environmentId: harness.environmentId, sessionId }))
      .toSorted(),
  )
  await user.click(
    within(screen.getByRole('toolbar', { name: 'Selected sessions' })).getByRole('button', {
      name: 'Actions',
    }),
  )
  await user.click(await screen.findByRole('menuitem', { name: /^Archive$/ }))
  await waitFor(async () =>
    expect((await harness.refresh()).sessions.every((session) => session.archivedAt !== null)).toBe(
      true,
    ),
  )
  expect(useSessionMultiSelectStore.getState().refs).toEqual([])
})

test('New session opens the scoped project before selecting its draft', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  renderRailHarness(harness)
  await userEvent.click(screen.getByRole('button', { name: 'All projects' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Rail project/ }))
  await userEvent.click(screen.getByRole('button', { name: 'New session' }))
  await waitFor(() =>
    expect(useSessionSelectionStore.getState().selection).toEqual({
      kind: 'draft',
      environmentId: harness.environmentId,
      projectId: harness.projectId,
      draftId: expect.stringMatching(/\S/),
    }),
  )
  expect(harness.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
    harness.context.worktree!.path,
  )
})

test('archiving pending input hides the row and late activity cannot restore it', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  const sessionId = harness.sessionIds[0]!
  const engine = orchestrationForApp(server.app)
  const deliver = (kind: string) =>
    engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'session.activity.append',
        commandId: `archive-attention-${kind}`,
        sessionId,
        createdAt: '2026-09-20T00:00:00.000Z',
        activity: {
          id: `activity-${kind}`,
          sessionId,
          kind,
          tone: 'error',
          summary: kind,
          payload: { requestId: 'archive-approval' },
          turnId: null,
          createdAt: '2026-09-20T00:00:00.000Z',
        },
      }),
    )
  await deliver('approval.requested')
  await harness.refresh()
  renderRailHarness(harness)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: /^Archive$/ }))
  await waitFor(() => expect(screen.queryByTitle('First')).toBeNull())
  await deliver('provider.error')
  await harness.refresh()
  expect(screen.queryByTitle('First')).toBeNull()
  const before = await engine.sessionDetailSnapshot(sessionId)
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  expect(screen.getByTitle('First')).toBeVisible()
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: /^Unarchive$/ }))
  await waitFor(async () =>
    expect(
      (await harness.refresh()).sessions.find((item) => item.id === sessionId)?.archivedAt,
    ).toBeNull(),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Archived sessions' }))
  expect(within(screen.getByRole('region', { name: 'Active' })).getByTitle('First')).toBeVisible()
  expect((await engine.sessionDetailSnapshot(sessionId)).session.activities).toEqual(
    before.session.activities,
  )
})
