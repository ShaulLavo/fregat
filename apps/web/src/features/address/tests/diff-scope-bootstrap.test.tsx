import {
  commandIdSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
  orchestrationCommandSchema,
  scopedSessionKey,
  turnIdSchema,
} from '@workspace/contracts'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { orchestrationForApp } from 'server/testing'
import { screen, waitFor } from '@testing-library/react'
import * as v from 'valibot'
import { expect, test } from '../../../../test/fixtures'
import { createRailHarness } from '../../../../test/factories/rail-harness'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { renderSessionDiffScope } from '../../../../test/factories/session-diff-scope'
import { createObservedInProcessClient } from '../../../../test/client'
import { AMBIGUOUS_SESSION } from '../../../../test/factories/session-domain'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { resetSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'
import { fetchOrchestrationSessionDetailSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'

test('automatic diff scope reconciliation resumes after pending bootstrap settles', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server, ['Automatic session'])
  const sessionId = harness.sessionIds[0]
  if (!sessionId) return expect.unreachable('automatic session is missing')
  const turnId = v.parse(turnIdSchema, 'retained-turn')
  const time = '2026-09-11T00:00:00.000Z'
  await orchestrationForApp(server.app).dispatch(
    v.parse(orchestrationCommandSchema, {
      type: 'session.turn.diff.complete',
      commandId: 'checkpoint',
      sessionId,
      turnId,
      completedAt: time,
      createdAt: time,
      checkpointRef: 'retained-checkpoint',
      checkpointTurnCount: 1,
      status: 'ready',
      files: [],
    }),
  )
  useChatProjectionStore
    .getState()
    .syncSessionDetailSnapshot(
      harness.environmentId,
      await fetchOrchestrationSessionDetailSnapshotHttp(sessionId, client),
    )
  resetSessionSelectionStore()
  const ref = { environmentId: harness.environmentId, sessionId }
  useSessionDiffScopeStore.getState().selectSessionDiffScope(ref, {
    kind: 'turn',
    turnId: v.parse(turnIdSchema, 'removed-turn'),
    filePath: null,
  })
  await harness.dispatch({
    type: 'session.create',
    commandId: v.parse(commandIdSchema, 'create-sidebar'),
    sessionId: AMBIGUOUS_SESSION,
    worktreeTarget: { kind: 'current', worktreeId: harness.worktreeId },
    title: 'Pending sidebar',
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'mock-model' },
  })
  await harness.dispatch({
    type: 'session.archive',
    commandId: v.parse(commandIdSchema, 'archive-sidebar'),
    sessionId: AMBIGUOUS_SESSION,
  })
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/orchestration/shell-snapshot') return
    started.resolve()
    await released.promise
  })
  const owner = harness.application.getSnapshot()
  registerEnvironmentQueryClient(owner.queryClient, owner.origin, observed)
  const root = owner.editor.workspaceStore.getState().rootFolder?.workspaceAddress
  if (!root) return expect.unreachable('registered root address is missing')
  const navigation = createTestNavigation({
    initialEntries: [`/~${workspaceToken(root)}/chat?chat=t/${AMBIGUOUS_SESSION}`],
  })
  const rendered = renderSessionDiffScope(harness, navigation)
  try {
    await started.promise
    expect(navigation.getSnapshot().status).toBe('pending')
    await waitFor(() =>
      expect(screen.getByLabelText('Resolved diff scope').textContent).toContain('retained-turn'),
    )
    expect(
      useSessionDiffScopeStore.getState().scopeBySessionKey[scopedSessionKey(ref)]?.scope,
    ).toMatchObject({ turnId: 'removed-turn' })
    released.resolve()
    await waitFor(() => expect(navigation.getSnapshot().status).toBe('applied'))
    await waitFor(() =>
      expect(
        useSessionDiffScopeStore.getState().scopeBySessionKey[scopedSessionKey(ref)]?.scope,
      ).toMatchObject({ turnId }),
    )
    expect(navigation.currentAddress().document).toBe(`t/${sessionId}`)
    expect(navigation.currentAddress().diff).toBe(turnId)
  } finally {
    released.resolve()
    rendered.unmount()
    navigation.dispose()
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, client)
  }
})
