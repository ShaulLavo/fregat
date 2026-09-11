import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { waitFor } from '@testing-library/react'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFilePreview } from '@workspace/client-core/files/read'
import { removedProjectRoot } from '@/features/chat-mode/state/removal'
import path from 'node:path'
import {
  commandIdSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
  environmentIdSchema,
  healthDescriptorSchema,
  orchestrationDispatchResultSchema,
  sessionIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import {
  useSessionSelectionStore,
  resetSessionSelectionStore,
} from '@/features/chat-mode/state/session-selection-store'
import {
  activeServerOrigin,
  getClient,
  setActiveServerOrigin,
  setClient,
  type Client,
} from '@/lib/client'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'
import { scopeAddressEnvironment } from '../../../../test/factories/address-environment'
import {
  renderAddressHarness,
  seedWorkspaceCache,
  startAt,
  waitForNavigation,
  pressBack,
} from '../../../../test/address'

const sessionId = v.parse(sessionIdSchema, '7090d847-eacb-47e3-88e4-71797a0b8d46')

test('identity drift during a pending shell read cannot publish address state', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'target'))
  const registration = await registerSession(client, 'target', 'Target')
  const previousProjection = useChatProjectionStore.getState()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const gated = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/orchestration/shell-snapshot') return
    started.resolve()
    await release.promise
  })
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const origin = 'http://localhost:37763'
  const restoreEnvironment = scopeAddressEnvironment(origin, descriptor.environmentId, gated)
  useChatProjectionStore.getState().resetChatProjection()
  resetSessionSelectionStore()
  seedWorkspaceCache({ rootPath: 'target', workspaceAddress: registration.workspaceAddress })
  startAt(`/~${workspaceToken(registration.workspaceAddress)}/chat/t/${sessionId}`)
  const rendered = await renderAddressHarness()
  try {
    await started.promise
    expect(() =>
      useEnvironmentsStore.getState().recordDescriptor(origin, {
        ...descriptor,
        environmentId: v.parse(environmentIdSchema, 'd7b4079f-a895-42df-b472-ed1785c7cc54'),
      }),
    ).toThrow()
    release.resolve()
    await waitFor(() => expect(rendered.navigation.getSnapshot().status).not.toBe('pending'))
    expect(useSessionSelectionStore.getState().selection).toEqual({ kind: 'auto' })
    expect(useChatProjectionStore.getState().slices[descriptor.environmentId]).toBeUndefined()
  } finally {
    release.resolve()
    rendered.unmount()
    restoreEnvironment()
    resetSessionSelectionStore()
    useChatProjectionStore.setState(previousProjection, true)
  }
})

test.for(['d7b4079f-a895-42df-b472-ed1785c7cc54', ''])(
  'a rejected environment token "%s" supersedes a pending valid restore',
  async (rejectedEnvironment, { client, server }) => {
    const previousProjection = useChatProjectionStore.getState()
    useChatProjectionStore.getState().resetChatProjection()
    await mkdir(path.join(server.root, 'target'))
    const registration = await registerSession(client, 'target', 'Target')
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const gated = createObservedInProcessClient(server, async (request) => {
      if (new URL(request.url).pathname !== '/orchestration/shell-snapshot') return
      started.resolve()
      await release.promise
    })
    const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
    const restoreEnvironment = scopeAddressEnvironment(
      rejectedEnvironment === '' ? 'http://localhost:37764' : 'http://localhost:37761',
      descriptor.environmentId,
      gated,
    )
    resetSessionSelectionStore()
    seedWorkspaceCache({ rootPath: 'source' })
    startAt(`/~${workspaceToken(registration.workspaceAddress)}/chat/t/${sessionId}`)
    const rejectedAddress = `/@${rejectedEnvironment}/~${workspaceToken(registration.workspaceAddress)}/chat/t/${sessionId}`
    const rendered = await renderAddressHarness({
      initialEntries: [
        rejectedAddress,
        `/~${workspaceToken(registration.workspaceAddress)}/chat/t/${sessionId}`,
      ],
    })
    try {
      await started.promise
      await pressBack(rendered.navigation)
      release.resolve()
      await waitForNavigation(rendered.navigation)
      expect(
        rendered.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path,
      ).toBe('source')
      expect(useSessionSelectionStore.getState().selection).toEqual({ kind: 'auto' })
      expect(rendered.navigation.router.history.location.pathname).toBe(rejectedAddress)
    } finally {
      release.resolve()
      rendered.unmount()
      restoreEnvironment()
      resetSessionSelectionStore()
      useChatProjectionStore.setState(previousProjection, true)
    }
  },
)

test('an older restore cannot settle a newer pending application', async ({ client, server }) => {
  await mkdir(path.join(server.root, 'target'))
  const registration = await registerSession(client, 'target', 'Target')
  const firstStarted = Promise.withResolvers<void>()
  const secondStarted = Promise.withResolvers<void>()
  const firstRelease = Promise.withResolvers<void>()
  const secondRelease = Promise.withResolvers<void>()
  let requests = 0
  const gated = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/orchestration/shell-snapshot') return
    requests += 1
    if (requests === 1) {
      firstStarted.resolve()
      await firstRelease.promise
      return
    }
    secondStarted.resolve()
    await secondRelease.promise
  })
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const restoreEnvironment = scopeAddressEnvironment(
    'http://localhost:37762',
    descriptor.environmentId,
    gated,
  )
  resetSessionSelectionStore()
  seedWorkspaceCache({ rootPath: 'source' })
  const target = `/~${workspaceToken(registration.workspaceAddress)}/chat/t/${sessionId}`
  startAt(target)
  const rendered = await renderAddressHarness({
    initialEntries: [`${target}?s.q=second`, `${target}?s.q=first`],
  })
  try {
    await firstStarted.promise
    rendered.navigation.back()
    await secondStarted.promise
    firstRelease.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rendered.navigation.getSnapshot().status).toBe('pending')
    secondRelease.resolve()
    await waitFor(() =>
      expect(useSessionSelectionStore.getState().selection).toMatchObject({
        kind: 'session',
        sessionId,
      }),
    )
    await waitFor(() => expect(rendered.navigation.getSnapshot().status).not.toBe('pending'))
  } finally {
    firstRelease.resolve()
    secondRelease.resolve()
    rendered.unmount()
    restoreEnvironment()
    resetSessionSelectionStore()
  }
})

test('A to B to A retains dirty documents, isolates shared session IDs and supersedes stale owners', async ({
  client,
  server,
}) => {
  const second = await makeTestServer({ filesystemWatch: false })
  const clientB = createInProcessClient(second)
  const originA = 'http://localhost:37661'
  const originB = 'http://localhost:37662'
  const previousOrigin = activeServerOrigin()
  const previousEnvironments = useEnvironmentsStore.getState()
  const previousProjection = useChatProjectionStore.getState()
  const descriptorA = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const descriptorB = v.parse(healthDescriptorSchema, (await clientB.health.get()).data)
  const registrationA = await registerSession(client, server.root, 'Session A', '')
  const registrationB = await registerSession(clientB, second.root, 'Session B', '')
  useChatProjectionStore
    .getState()
    .syncShellSnapshot(descriptorA.environmentId, await fetchOrchestrationShellSnapshotHttp(client))
  useChatProjectionStore
    .getState()
    .syncShellSnapshot(
      descriptorB.environmentId,
      await fetchOrchestrationShellSnapshotHttp(clientB),
    )
  useEnvironmentsStore.setState({
    entries: {
      [originA]: {
        ...createEnvironmentEntry(originA, originA),
        origin: originA,
        kind: 'primary',
        label: 'A',
        environmentId: descriptorA.environmentId,
      },
      [originB]: {
        ...createEnvironmentEntry(originB, originA),
        origin: originB,
        kind: 'origin',
        label: 'B',
        environmentId: descriptorB.environmentId,
      },
    },
  })
  setActiveServerOrigin(originA)
  const previousClientA = getClient()
  setClient(client)
  setActiveServerOrigin(originB)
  const previousClientB = getClient()
  setClient(clientB)
  useEnvironmentsStore.getState().activate(originA)
  resetSessionSelectionStore()
  seedWorkspaceCache({ rootPath: 'source' })
  startAt(`/~${workspaceToken(registrationA.workspaceAddress)}/chat/t/${sessionId}`)
  const rendered = await renderAddressHarness()

  try {
    await waitForNavigation(rendered.navigation)
    const retainedA = rendered.application.getSnapshot().editor
    expect(
      removedProjectRoot(
        { environmentId: descriptorA.environmentId, projectId: registrationA.projectId },
        '',
      ),
    ).toBe('')
    await writeFile(path.join(server.root, 'retained.ts'), 'export const retained = true\n')
    const file = await readFilePreview({
      client,
      path: 'retained.ts',
      signal: new AbortController().signal,
    })
    retainedA.documentStore.getState().ensureLiveEditorDocument(file)
    retainedA.documentStore.getState().setLiveEditorDocumentDirty(file.path, true)
    expect(
      await rendered.navigation.openFile({ owner: retainedA.workspaceStore, path: file.path }),
    ).toEqual({ status: 'applied' })
    expect(
      await rendered.navigation.openChat({
        environmentId: descriptorB.environmentId,
        sessionId,
        surface: 'main',
      }),
    ).toEqual({ status: 'applied' })
    await waitFor(() =>
      expect(useSessionSelectionStore.getState().selection).toMatchObject({
        kind: 'session',
        environmentId: descriptorB.environmentId,
        projectId: registrationB.projectId,
        sessionId,
      }),
    )
    expect(rendered.application.getSnapshot().origin).toBe(originB)
    expect(
      rendered.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path,
    ).toBe('')
    expect(
      useChatProjectionStore.getState().slices[descriptorA.environmentId]?.sessionById[sessionId]
        ?.title,
    ).toBe('Session A')
    expect(registrationA.projectId).not.toBe(registrationB.projectId)
    await waitForNavigation(rendered.navigation)
    expect(rendered.navigation.router.history.location.pathname).toContain(
      `/@${descriptorB.environmentId}/`,
    )
    const reachedB = rendered.navigation.router.history.location.href
    expect(reachedB).toContain(`/chat/t/${sessionId}`)
    expect(
      await rendered.navigation.openFile({ owner: retainedA.workspaceStore, path: file.path }),
    ).toEqual({ status: 'superseded' })
    expect(rendered.navigation.router.history.location.href).toBe(reachedB)
    expect(rendered.application.getSnapshot().origin).toBe(originB)
    await pressBack(rendered.navigation)
    expect(rendered.application.getSnapshot().origin).toBe(originA)
    expect(rendered.application.getSnapshot().editor).toBe(retainedA)
    expect(retainedA.documentStore.getState().dirtyFilePaths.has(file.path)).toBe(true)
    expect(retainedA.workspaceStore.getState().selectedFilePath).toBe(file.path)
    rendered.navigation.forward()
    await waitForNavigation(rendered.navigation)
    expect(rendered.navigation.router.history.location.href).toBe(reachedB)
    expect(rendered.application.getSnapshot().origin).toBe(originB)
  } finally {
    rendered.unmount()
    rendered.application.dispose()
    queryClientFor(originA).clear()
    queryClientFor(originB).clear()
    useEnvironmentsStore.setState(previousEnvironments, true)
    useChatProjectionStore.setState(previousProjection, true)
    setActiveServerOrigin(originA)
    setClient(previousClientA)
    setActiveServerOrigin(originB)
    setClient(previousClientB)
    setActiveServerOrigin(previousOrigin)
    resetSessionSelectionStore()
    await second.cleanup()
  }
})

async function registerSession(
  client: Client,
  workspaceRoot: string,
  title: string,
  filesystemPath = workspaceRoot,
) {
  const registration = v.parse(
    orchestrationDispatchResultSchema,
    (
      await client.orchestration.commands.post({
        type: 'project.create',
        commandId: v.parse(commandIdSchema, 'address-project'),
        title,
        workspaceRoot,
        defaultModelSelection: null,
      })
    ).data,
  )
  const result = registration.result
  if (!result) return expect.unreachable('registration returned no identity')
  const created = await client.orchestration.commands.post({
    type: 'session.create',
    commandId: v.parse(commandIdSchema, 'address-session'),
    sessionId,
    worktreeTarget: { kind: 'current', worktreeId: result.worktreeId },
    title,
    runtimeMode: 'full-access',
    interactionMode: 'default',
    modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
  })
  expect(created.error).toBeNull()
  const workspaceAddress = await registerTestWorkspaceAddress(client, filesystemPath)
  return { ...result, workspaceAddress }
}
