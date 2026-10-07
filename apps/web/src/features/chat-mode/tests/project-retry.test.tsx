import { act, waitFor } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../test/render'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../test/factories/federation'
import { useProjectRetry } from '@/features/chat-mode/hooks/use-project-retry'
import { transportFor } from '@/features/chat/state/active-transports'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'

test('live folder retry registers and settles the real projection without duplicate worktrees', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const project = await registerFederatedProject(server, h.clientA, 'retry')
  await waitFor(() => expect(transportFor(h.descriptorA.environmentId)?.closed).toBe(false))
  const transport = transportFor(h.descriptorA.environmentId)!
  const hook = renderHookWithProviders(() => useProjectRetry({ transport, rootPath: 'repo' }), {
    connections: h.connections,
  })
  act(() => hook.result.current.retryProject())
  await waitFor(() =>
    expect(hook.queryClient.getMutationCache().getAll().at(-1)?.state.status).toBe('success'),
  )
  expect(hook.result.current.error).toBeNull()
  expect(
    useChatProjectionStore.getState().slices[h.descriptorA.environmentId]?.worktreeById[
      project.worktreeId!
    ],
  ).toBeDefined()
  const snapshot = (await h.clientA.orchestration['shell-snapshot'].get()).data!
  expect(snapshot.worktrees.filter((entry) => entry.path === 'repo')).toHaveLength(1)
})

test('changing folders drops the previous retry error while genuine current-folder errors remain visible', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await waitFor(() => expect(transportFor(h.descriptorA.environmentId)?.closed).toBe(false))
  const transport = transportFor(h.descriptorA.environmentId)!
  const hook = renderHookWithProviders(({ rootPath }) => useProjectRetry({ transport, rootPath }), {
    connections: h.connections,
    initialProps: { rootPath: 'missing-folder' },
  })
  act(() => hook.result.current.retryProject())
  await waitFor(() => expect(hook.result.current.error).not.toBeNull())
  hook.rerender({ rootPath: 'another-folder' })
  expect(hook.result.current.error).toBeNull()
  expect(hook.result.current.retrying).toBe(false)
})

test('a replaced transport cannot report its in-flight retry failure', async ({ server }) => {
  const h = await createFederationHarness(server)
  await waitFor(() => expect(transportFor(h.descriptorA.environmentId)?.closed).toBe(false))
  const transport = transportFor(h.descriptorA.environmentId)!
  const socket = h.sockets.get(h.originA)!.at(-1)!
  const send = socket.send.bind(socket)
  const requested = Promise.withResolvers<void>()
  socket.send = (raw) => {
    const message = JSON.parse(raw)
    if (message.method === 'dispatchCommand') return requested.resolve()
    send(raw)
  }
  const hook = renderHookWithProviders(
    ({ transport }) => useProjectRetry({ transport, rootPath: 'missing-folder' }),
    {
      connections: h.connections,
      initialProps: { transport },
    },
  )
  act(() => hook.result.current.retryProject())
  await requested.promise
  await act(() => h.connections.retryPrimary())
  const replacement = transportFor(h.descriptorA.environmentId)!
  expect(replacement).not.toBe(transport)
  expect(transport.closed).toBe(true)
  hook.rerender({ transport: replacement })
  await waitFor(() => expect(hook.result.current.retrying).toBe(false))
  expect(hook.result.current.error).toBeNull()
})

test('retry of a permanently closed connection delegates replacement to its environment owner', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await registerFederatedProject(server, h.clientA, 'closed-retry')
  await waitFor(() => expect(transportFor(h.descriptorA.environmentId)?.closed).toBe(false))
  const transport = transportFor(h.descriptorA.environmentId)!
  transport.close()
  const hook = renderHookWithProviders(
    ({ transport }) => useProjectRetry({ transport, rootPath: 'repo' }),
    {
      connections: h.connections,
      initialProps: { transport },
    },
  )
  act(() => hook.result.current.retryProject())
  await waitFor(() => expect(transportFor(h.descriptorA.environmentId)?.closed).toBe(false))
  const replacement = transportFor(h.descriptorA.environmentId)!
  expect(replacement).not.toBe(transport)
  hook.rerender({ transport: replacement })
  expect(hook.result.current.error).toBeNull()
  const snapshot = (await h.clientA.orchestration['shell-snapshot'].get()).data!
  expect(snapshot.worktrees.filter((entry) => entry.path === 'repo')).toHaveLength(1)
})
