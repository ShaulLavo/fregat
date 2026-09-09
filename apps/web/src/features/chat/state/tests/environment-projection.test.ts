import {
  healthDescriptorSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_INTERACTION_MODE,
} from '@workspace/contracts'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { registerTerminalCheckout } from '@/features/terminal/state/register-checkout'
import { environmentIdSchema, commandIdSchema, scopedSessionKey } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, test } from '../../../../../test/fixtures'
import {
  chatMessage,
  chatWorktree,
  orchestrationSession,
  shellSnapshot,
  TEST_ENVIRONMENT_ID,
  TEST_SESSION_ID,
} from '../../../../../test/factories/chat'
import { useChatProjectionStore, selectChatProjectionSlice } from '../chat-projection-store'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { useChatOptimisticStore } from '../chat-optimistic-store'

const OTHER_ENVIRONMENT_ID = v.parse(environmentIdSchema, 'ce20f2c3-d736-407e-90ad-659f702b3565')

test('identical session and checkout IDs stay in their producing environment', () => {
  const store = useChatProjectionStore.getState()
  store.resetChatProjection()
  store.syncShellSnapshot(TEST_ENVIRONMENT_ID, {
    ...shellSnapshot({ worktrees: [chatWorktree({ path: '/machine-a' })] }),
    snapshotSequence: 90,
  })
  store.syncShellSnapshot(OTHER_ENVIRONMENT_ID, {
    ...shellSnapshot({ worktrees: [chatWorktree({ path: '/machine-b' })] }),
    snapshotSequence: 2,
  })
  store.syncSessionDetailSnapshot(OTHER_ENVIRONMENT_ID, {
    session: orchestrationSession({ messages: [chatMessage({ text: 'B transcript' })] }),
    proposedPlans: [],
    checkpoints: [],
    snapshotSequence: 3,
  })
  const state = useChatProjectionStore.getState()
  const a = selectChatProjectionSlice(state, TEST_ENVIRONMENT_ID)
  const b = selectChatProjectionSlice(state, OTHER_ENVIRONMENT_ID)
  expect(selectChatSessionById(a, TEST_SESSION_ID)?.worktree.path).toBe('/machine-a')
  expect(selectChatSessionById(b, TEST_SESSION_ID)?.worktree.path).toBe('/machine-b')
  expect(selectChatSessionById(a, TEST_SESSION_ID)?.messages).toEqual([])
  expect(selectChatSessionById(b, TEST_SESSION_ID)?.messages[0]?.text).toBe('B transcript')
  expect(b.lastAppliedShellSequence).toBe(2)
  store.resetChatProjection()
})

test('an echoed optimistic message clears only its producing environment', () => {
  const store = useChatOptimisticStore.getState()
  const message = chatMessage()
  const commandId = v.parse(commandIdSchema, 'collision-command')
  store.addOptimisticMessage(TEST_ENVIRONMENT_ID, commandId, message)
  store.addOptimisticMessage(OTHER_ENVIRONMENT_ID, commandId, message)
  const a = { environmentId: TEST_ENVIRONMENT_ID, sessionId: TEST_SESSION_ID }
  const b = { environmentId: OTHER_ENVIRONMENT_ID, sessionId: TEST_SESSION_ID }
  store.clearResolvedOptimisticMessages(a, [message])
  const state = useChatOptimisticStore.getState()
  expect(state.messagesBySessionKey[scopedSessionKey(a)]).toBeUndefined()
  expect(state.messagesBySessionKey[scopedSessionKey(b)]?.[message.id]).toBeDefined()
  store.removeOptimisticMessage(b, message.id)
})

test('inactive environment commands refresh their slice and terminal registration keeps its owner', async ({
  client,
}) => {
  const origin = 'http://scoped-command.test'
  const previousOrigin = activeServerOrigin()
  const previousClient = getClient()
  const previousEnvironments = useEnvironmentsStore.getState()
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  useChatProjectionStore.getState().resetChatProjection()
  useEnvironmentsStore.setState({ entries: {}, connectionByOrigin: {} })
  useEnvironmentsStore.getState().activate(origin)
  setClient(client)
  useEnvironmentsStore.getState().recordDescriptor(origin, descriptor)
  useEnvironmentsStore.getState().activate('http://other-active.test')
  try {
    const registered = await dispatchCommandForEnvironment(descriptor.environmentId, {
      type: 'project.create',
      commandId: v.parse(commandIdSchema, 'scoped-project'),
      workspaceRoot: '',
      title: 'Inactive',
      defaultModelSelection: null,
    })
    const worktreeId = registered.result!.worktreeId
    await dispatchCommandForEnvironment(descriptor.environmentId, {
      type: 'session.create',
      commandId: v.parse(commandIdSchema, 'scoped-session'),
      worktreeTarget: { kind: 'current', worktreeId: worktreeId },
      sessionId: TEST_SESSION_ID,
      title: 'Before',
      modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'mock-model' },
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
    })
    await dispatchCommandForEnvironment(descriptor.environmentId, {
      type: 'session.meta.update',
      commandId: v.parse(commandIdSchema, 'scoped-rename'),
      sessionId: TEST_SESSION_ID,
      title: 'After',
    })
    const slice = selectChatProjectionSlice(
      useChatProjectionStore.getState(),
      descriptor.environmentId,
    )
    expect(slice.sessionById[TEST_SESSION_ID]?.title).toBe('After')
    expect(slice.worktreeById[worktreeId]?.path).toBe('')
    expect(activeServerOrigin()).toBe('http://other-active.test')
    const signal = new AbortController().signal
    expect(await registerTerminalCheckout({ client, origin, rootPath: '', signal })).toBe(
      worktreeId,
    )
    expect(() =>
      useEnvironmentsStore
        .getState()
        .recordDescriptor(origin, { ...descriptor, environmentId: OTHER_ENVIRONMENT_ID }),
    ).toThrow()
    await expect(
      registerTerminalCheckout({ client, origin, rootPath: '', signal }),
    ).rejects.toMatchObject({ code: 'ENVIRONMENT_IDENTITY_DRIFT' })
  } finally {
    useEnvironmentsStore.setState(previousEnvironments, true)
    setActiveServerOrigin(previousOrigin)
    setClient(previousClient)
    useChatProjectionStore.getState().resetChatProjection()
  }
})
