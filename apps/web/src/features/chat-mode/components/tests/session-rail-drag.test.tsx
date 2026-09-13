import * as v from 'valibot'
import { screen, waitFor } from '@testing-library/react'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  scopedSessionKey,
  scopedProjectKey,
  commandIdSchema,
  sessionIdSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
} from '@workspace/contracts'
import {
  reorderRailProject,
  reorderRailSession,
} from '@/features/chat-mode/state/rail-order-commands'
import { railOrderOverrides } from '@/features/chat-mode/state/rail-order-intents'
import { createSessionArchiveCommand } from '@workspace/client-core/chat/commands'
import { createProjectRegistrationCommand } from '@workspace/client-core/chat/registration'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import {
  installVerticalRailRects,
  dragRailWithKeyboard,
} from '../../../../../test/factories/rail-drag'
import { expect, test } from '../../../../../test/fixtures'

test('keyboard dragging places a real session and settles its scoped optimistic key', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  installVerticalRailRects()
  renderRailHarness(h)
  await dragRailWithKeyboard(screen.getByTitle('First'), '{ArrowUp}')
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.pinOrderKey,
    ).not.toBeNull(),
  )
  expect(
    railOrderOverrides().sessionOrderKeys[
      scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[0]! })
    ],
  ).toBeUndefined()
})
test('reordering scopes session ids before dispatch and persists only the moved row', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const first = scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[0]! })
  const second = scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[1]! })
  reorderRailSession({ activeId: first, overId: second })
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.pinOrderKey,
    ).not.toBeNull(),
  )
  expect(
    (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[1])?.pinOrderKey,
  ).toBeNull()
})
test('archived sessions cannot acquire a new pin order through the rail', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  await h.dispatch(createSessionArchiveCommand({ sessionId: h.sessionIds[0]! }))
  await h.refresh()
  reorderRailSession({
    activeId: scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[0]! }),
    overId: scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[1]! }),
  })
  expect(
    (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.pinOrderKey,
  ).toBeNull()
  expect(railOrderOverrides().sessionOrderKeys).toEqual({})
})
test('a project reorder persists on its owning machine', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  const path = join(server.root, 'site')
  await mkdir(path)
  const receipt = await h.dispatch(
    createProjectRegistrationCommand({ workspaceRoot: path, title: 'Site' }),
  )
  const other = receipt.result!
  await h.refresh()
  // Project handles belong to sections; order remains one shared repository order.
  await h.dispatch({
    type: 'session.create',
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    commandId: v.parse(commandIdSchema, 'rail-other-session'),
    sessionId: v.parse(sessionIdSchema, 'f0000000-0000-4000-8000-000000000003'),
    worktreeTarget: { kind: 'current', worktreeId: other.worktreeId },
    title: 'Site work',
    modelSelection: { model: 'mock-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
  })
  await h.refresh()
  const firstKey = scopedProjectKey({ environmentId: h.environmentId, projectId: h.projectId })
  expect(firstKey).toContain(h.environmentId)
  reorderRailProject({ activeId: `settled:${h.projectId}`, overId: `settled:${other.projectId}` })
  await waitFor(async () =>
    expect(
      (await h.refresh()).projects.find((project) => project.id === h.projectId)?.orderKey,
    ).not.toBeNull(),
  )
  expect(railOrderOverrides().projectOrderKeys[firstKey]).toBeUndefined()
})
