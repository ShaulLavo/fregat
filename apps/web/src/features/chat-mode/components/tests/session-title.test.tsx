import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createError } from 'evlog'
import { MockProviderAdapter } from 'server/testing'
import {
  createSessionRegenerateTitleCommand,
  createSessionRenameCommand,
  createTurnSubmission,
} from '@workspace/client-core/chat/commands'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'

test('row title requests expose durable pending state and manual rename clears it', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Regenerate title' }))
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])
        ?.titleRegeneration,
    ).toBeTruthy(),
  )
  expect(await screen.findByRole('status', { name: 'Generating title' })).toBeVisible()
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  expect(await screen.findByRole('menuitem', { name: 'Regenerating…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.keyboard('{Escape}')
  await h.dispatch(
    createSessionRenameCommand({ sessionId: h.sessionIds[0]!, title: 'Manual title wins' }),
  )
  await h.refresh()
  expect(await screen.findByTitle('Manual title wins')).toBeVisible()
  expect(screen.queryByRole('status', { name: 'Generating title' })).toBeNull()
})

test('bulk title requests skip pending rows and preserve only their selection', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  await h.dispatch(createSessionRegenerateTitleCommand(h.sessionIds[0]!))
  await h.refresh()
  const refs = h.sessionIds.map((sessionId) => ({ environmentId: h.environmentId, sessionId }))
  useSessionMultiSelectStore.setState({ refs, anchor: refs[0]! })
  renderRailHarness(h)
  await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Regenerate titles (1)' }))
  await waitFor(async () =>
    expect((await h.refresh()).sessions.every((session) => session.titleRegeneration)).toBe(true),
  )
  expect(useSessionMultiSelectStore.getState().refs).toEqual([refs[0]])
  expect(await screen.findByText('1 title request accepted, 1 skipped')).toBeVisible()
})

test('provider failure is visible and a retry updates the real canonical title', async ({
  client,
  server,
}) => {
  let failing = true
  const adapter = new MockProviderAdapter({
    responseText: JSON.stringify({ title: 'Generated useful title', needsRefinement: false }),
    beforeComplete: () => {
      if (failing) throw createError({ status: 503, message: 'Title fixture provider unavailable' })
    },
  })
  await server.restart({ providerRuntime: true, providerAdapter: adapter })
  const h = await createRailHarness(client, server)
  await h.dispatch(
    createTurnSubmission({
      sessionId: h.sessionIds[0]!,
      text: 'Explain the queue ownership model',
      createdAt: new Date().toISOString(),
      modelSelection: (await h.refresh()).sessions[0]!.modelSelection!,
      runtimeMode: 'full-access',
      interactionMode: 'default',
    }).command,
  )
  renderRailHarness(h)
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Regenerate title' }))
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])
        ?.titleGenerationError,
    ).toBeTruthy(),
  )
  expect(await screen.findByText('Title generation failed')).toBeVisible()
  failing = false
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle('First') })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Retry title generation' }))
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.title,
    ).toBe('Generated useful title'),
  )
  expect(await screen.findByTitle('Generated useful title')).toBeVisible()
  expect(screen.queryByText('Title generation failed')).toBeNull()
})
