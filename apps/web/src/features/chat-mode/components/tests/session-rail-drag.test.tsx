import { sessionDropPatch } from '@/features/chat-mode/utils/rail-drop'
import {
  dropEntryAcknowledged,
  dropEntryConflicts,
} from '@/features/chat-mode/utils/rail-drop-state'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { railOrderIntents } from '@/features/chat-mode/state/rail-order-intents'
import { railOrderErrors } from '@/features/chat-mode/utils/rail-order-errors'
import { railMarkerId } from '@workspace/client-core/chat/rail/drop'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
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
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { railOrderOverrides } from '@/features/chat-mode/state/rail-order-intents'
import {
  createSessionLifecycleCommand,
  createSessionArchiveCommand,
} from '@workspace/client-core/chat/commands'
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
  for (const sessionId of h.sessionIds)
    await h.dispatch(createSessionLifecycleCommand(sessionId, { type: 'pin' }))
  await h.refresh()
  installVerticalRailRects()
  renderRailHarness(h)
  const rows = screen
    .getAllByRole('option')
    .filter((row) => row.getAttribute('aria-roledescription') === 'sortable session row')
  const moved = rows.at(-1)!
  const movedId = h.sessionIds[moved.title === 'First' ? 0 : 1]!
  await dragRailWithKeyboard(moved, '{ArrowUp}')
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === movedId)?.pinOrderKey,
    ).not.toBeNull(),
  )
  expect(
    railOrderOverrides().sessionLifecycleByKey?.[
      scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[0]! })
    ],
  ).toBeUndefined()
})
test('reordering scopes session ids before dispatch and materializes visible keyless neighbors', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  for (const sessionId of h.sessionIds)
    await h.dispatch(createSessionLifecycleCommand(sessionId, { type: 'pin' }))
  await h.refresh()
  const secondOrder = (await h.refresh()).sessions.find(
    (session) => session.id === h.sessionIds[1],
  )?.pinOrderKey
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
  ).not.toBe(secondOrder)
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
  expect(railOrderOverrides().sessionLifecycleByKey ?? {}).toEqual({})
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
  const model = sessionRailModel({ environments: currentRailEnvironments() })
  const firstGroup = model.groups.find((group) => group.project.id === h.projectId)!
  const otherGroup = model.groups.find((group) => group.project.id === other.projectId)!
  reorderRailProject({ activeId: firstGroup.key, overId: otherGroup.key })
  await waitFor(async () =>
    expect(
      (await h.refresh()).projects.find((project) => project.id === h.projectId)?.orderKey,
    ).not.toBeNull(),
  )
  expect(railOrderOverrides().projectOrderKeys[firstKey]).toBeUndefined()
})

test('non-draggable active sessions remain accessible navigation buttons', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  expect(screen.getByTitle('First')).not.toHaveAttribute('aria-disabled', 'true')
  reorderRailSession({
    activeId: scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[0]! }),
    overId: scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[1]! }),
  })
  expect((await h.refresh()).sessions.every((session) => session.pinnedAt === null)).toBe(true)
})

test('structural shelf drops persist pin, settle and active placement with complete optimistic acknowledgement', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  useEnvironmentsStore.setState((state) => ({
    entries: Object.fromEntries(
      Object.entries(state.entries).map(([key, entry]) => [
        key,
        {
          ...entry,
          descriptor: entry.descriptor
            ? {
                ...entry.descriptor,
                capabilities: entry.descriptor.capabilities
                  ? { ...entry.descriptor.capabilities, sessionActiveReorder: true }
                  : undefined,
              }
            : null,
        },
      ]),
    ),
  }))
  const first = scopedSessionKey({ environmentId: h.environmentId, sessionId: h.sessionIds[0]! })
  const drop = async (
    marker: 'pinned-header' | 'settled-placeholder' | 'active-placeholder',
    matches: (session: Awaited<ReturnType<typeof h.refresh>>['sessions'][number]) => boolean,
  ) => {
    const result = reorderRailSession({ activeId: first, overId: railMarkerId(marker) })
    await waitFor(async () =>
      expect(
        matches((await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])!),
      ).toBe(true),
    )
    expect((await result)?.ok).toBe(true)
    expect(railOrderOverrides().sessionLifecycleByKey?.[first]).toBeUndefined()
  }
  await drop('pinned-header', (session) => Boolean(session.pinnedAt))
  await drop(
    'settled-placeholder',
    (session) => session.settledOverride === 'settled' && !session.pinnedAt,
  )
  await drop(
    'active-placeholder',
    (session) => session.settledOverride === 'active' && Boolean(session.activeOrderKey),
  )
  await h.dispatch(
    createSessionLifecycleCommand(h.sessionIds[0]!, {
      type: 'snooze',
      snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
    }),
  )
  await h.refresh()
  await drop('pinned-header', (session) => Boolean(session.pinnedAt) && !session.snoozedUntil)
})

test('keyboard can pin an active row onto an empty pinned shelf', async ({ client, server }) => {
  const h = await createRailHarness(client, server, ['Only'])
  installVerticalRailRects()
  renderRailHarness(h)
  await dragRailWithKeyboard(screen.getByTitle('Only'), '{ArrowUp}{ArrowUp}')
  await waitFor(async () => expect((await h.refresh()).sessions[0]?.pinnedAt).not.toBeNull())
})

test('lifecycle confirmation alone cannot retire a drop before its key, and a stale failure cannot erase a newer preview', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  await h.dispatch(createSessionLifecycleCommand(h.sessionIds[0]!, { type: 'settle' }))
  await h.refresh()
  const model = sessionRailModel({ environments: currentRailEnvironments() })
  const row = model.sessions.find((item) => item.id === h.sessionIds[0])!
  const patch = sessionDropPatch(
    row,
    {
      kind: 'move-active',
      order: [row.key],
      assignments: [{ id: row.key, orderKey: 'm' }],
      unpin: false,
      unsettle: true,
      unsnooze: false,
    },
    new Map([[row.key, row]]),
    new Date().toISOString(),
  )!
  const entry = patch.entries[0]!
  const read = () => useChatProjectionStore.getState().slices[h.environmentId]!.sessionById[row.id]!
  await h.dispatch(patch.commands[0]!.command)
  await h.refresh()
  expect(dropEntryAcknowledged(entry, read())).toBe(false)
  expect(dropEntryConflicts(patch, entry, read())).toBe(false)
  await h.dispatch(patch.commands[1]!.command)
  await h.refresh()
  expect(dropEntryAcknowledged(entry, read())).toBe(true)
  expect(dropEntryConflicts(patch, entry, { ...read(), activeOrderKey: 't' })).toBe(true)
  expect(
    dropEntryConflicts(patch, entry, { ...read(), archivedAt: new Date().toISOString() }),
  ).toBe(true)
  const older = railOrderIntents.submit(patch, { resources: [row.key] })
  const newer = railOrderIntents.submit(
    { ...patch, entries: [{ ...entry, preview: { ...entry.preview, activeOrderKey: 'z' } }] },
    { resources: [row.key] },
  )
  railOrderIntents.fail(older.intent.intentId, railOrderErrors.DROP_CHANGED())
  expect(railOrderOverrides().sessionLifecycleByKey?.[row.key]?.activeOrderKey).toBe('z')
  railOrderIntents.discard(newer.intent.intentId)
})
