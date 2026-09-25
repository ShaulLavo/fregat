import { waitFor } from '@testing-library/react'
import { onTestFinished } from 'vitest'

import { createDiagnosticFix } from '@/state/diagnostic-fix'
import { renderWithProviders } from '../../../test/render'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import type { ComposerDestination } from '@/lib/composer-attach/providers/context'
import { FocusService } from '@/lib/focus/state/service'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import { createObservedInProcessClient } from '../../../test/client'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../test/factories/federation'
import { createTestNavigation } from '../../../test/factories/navigation'
import { createTestCommandRuntime } from '../../../test/factories/command-runtime'
import { expect, test } from '../../../test/fixtures'

test('a diagnostic read started on A opens its draft on A after switching to B at the same path', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await registerFederatedProject(h.serverA, h.clientA, 'machine A excerpt')
  await registerFederatedProject(h.serverB, h.clientB, 'machine B excerpt')
  await h.application.openEnvironmentWorkspaceRoot(h.descriptorA.environmentId, 'repo')
  const owner = h.application.getSnapshot()
  expect(owner.editor.workspaceStore.getState().rootFolder?.path).toBe('repo')
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const client = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/fs/read') return
    entered.resolve()
    await release.promise
  })
  const navigation = createTestNavigation({ application: h.application })
  renderWithProviders(<div />, {
    application: h.application,
    navigation,
    connections: h.connections,
  })
  onTestFinished(() => {
    release.resolve()
    navigation.dispose()
  })
  const runtime = createTestCommandRuntime({
    application: h.application,
    navigation,
    focus: new FocusService(),
    queryClient: owner.queryClient,
  })
  registerEnvironmentQueryClient(owner.queryClient, h.originA, client)
  const destinations: ComposerDestination[] = []
  const fix = createDiagnosticFix({
    attach: {
      ...runtime.runtime.composer,
      attachTextToNewChat: (source, text, destination) => {
        destinations.push(destination)
        return runtime.runtime.composer.attachTextToNewChat(source, text, destination)
      },
    },
    documents: owner.editor.documentStore,
    queryClient: owner.queryClient,
    workspace: owner.editor.workspaceStore,
  })
  const pending = fix({
    path: 'repo/shared.txt',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message: 'Fix this',
    code: null,
    severity: 1,
    source: null,
    surface: 'problems',
  })
  await Promise.race([
    entered.promise,
    pending.then((result) => {
      throw new Error(`Fix finished before read: ${result}`)
    }),
  ])
  h.application.activateEnvironment(h.originB)
  await h.application.openEnvironmentWorkspaceRoot(h.descriptorB.environmentId, 'repo')
  release.resolve()
  await waitFor(() => expect(destinations).toHaveLength(1))
  expect(destinations).toEqual([{ environmentId: h.descriptorA.environmentId, rootPath: 'repo' }])
  await pending
  await waitFor(() =>
    expect(
      Object.values(useChatInputDraftStore.getState().draftsByKey).some(
        (draft) =>
          draft.prompt.includes('machine A excerpt') && draft.identity?.rootPath === 'repo',
      ),
    ).toBe(true),
  )
  expect(h.application.getSnapshot().origin).toBe(h.originA)
})

test('captures the source machine before awaiting the diagnostic file read', async ({ server }) => {
  const h = await createFederationHarness(server)
  await registerFederatedProject(h.serverA, h.clientA, 'A')
  await registerFederatedProject(h.serverB, h.clientB, 'B')
  await h.application.openEnvironmentWorkspaceRoot(h.descriptorA.environmentId, 'repo')
  const owner = h.application.getSnapshot()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  onTestFinished(() => release.resolve())
  registerEnvironmentQueryClient(
    owner.queryClient,
    h.originA,
    createObservedInProcessClient(server, async (request) => {
      if (new URL(request.url).pathname !== '/fs/read') return
      entered.resolve()
      await release.promise
    }),
  )
  const destinations: ComposerDestination[] = []
  const fix = createDiagnosticFix({
    attach: {
      attachText: () => false,
      attachTerminalContext: () => false,
      attachTextToNewChat: async (_source, _text, destination) => {
        destinations.push(destination)
        return true
      },
    },
    documents: owner.editor.documentStore,
    workspace: owner.editor.workspaceStore,
    queryClient: owner.queryClient,
  })
  const pending = fix({
    path: 'repo/shared.txt',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message: 'Fix this',
    code: null,
    severity: 1,
    source: null,
    surface: 'problems',
  })
  await entered.promise
  h.application.activateEnvironment(h.originB)
  release.resolve()
  await pending
  expect(destinations).toEqual([{ environmentId: h.descriptorA.environmentId, rootPath: 'repo' }])
})
