import { waitFor } from '@testing-library/react'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  commandIdSchema,
  orchestrationDispatchResultSchema,
  healthDescriptorSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import {
  selectChatProjects,
  selectChatSessions,
  selectChatWorktrees,
} from '@workspace/client-core/chat/selectors'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { expect, test } from '../../../../test/fixtures'
import { createInProcessClient } from '../../../../test/client'
import { makeTestServer } from '../../../../test/server'
import {
  AMBIGUOUS_SESSION,
  DOMAIN_MODEL,
  DOMAIN_SESSION,
  DOMAIN_TIME,
  TERMINAL_SESSION,
  MetadataProviderAdapter,
  executeDomainGit,
  makeSessionDomainFixture,
} from '../../../../test/factories/session-domain'

test('registration receipts survive reconstruction, including a no-event registration with an unavailable path', async () => {
  const fixture = await makeSessionDomainFixture()
  try {
    const created = await fixture.register('first-registration')
    expect(created.result).toMatchObject({
      projectId: 'ff06e766-44c7-51e2-95ef-9d10415f171b',
      disposition: 'created-project',
    })
    const existing = await fixture.register('same-checkout')
    expect(existing.sequence).toBe(created.sequence)
    expect(existing.deduped).toBe(false)
    await fixture.server.restart()
    await rename(fixture.main, `${fixture.main}-unavailable`)
    expect(await fixture.register('first-registration')).toEqual({ ...created, deduped: true })
    expect(await fixture.register('same-checkout')).toEqual({ ...existing, deduped: true })
    expect(
      v.parse(healthDescriptorSchema, (await fixture.client.health.get()).data).environmentId,
    ).toBe(fixture.descriptor.environmentId)
  } finally {
    await fixture.server.cleanup()
  }
})

test('restart catches up before readiness, imports terminal history, and converges scoped web projections', async () => {
  const fixture = await makeSessionDomainFixture()
  const second = await makeTestServer({ filesystemWatch: false })
  const previousProjection = useChatProjectionStore.getState()
  try {
    const registered = await fixture.register()
    if (!registered.result) throw new TypeError('Missing registration result')
    await fixture.createSession(registered.result.worktreeId)
    await fixture.createSession(registered.result.worktreeId, AMBIGUOUS_SESSION)
    await fixture.startTurn()
    await fixture.startTurn(AMBIGUOUS_SESSION)
    const queued = (await fixture.session(AMBIGUOUS_SESSION)).latestTurn
    if (!queued) throw new TypeError('Missing queued turn')
    await fixture.internal({
      type: 'session.provider-start.claim',
      commandId: 'claim-before-crash',
      sessionId: AMBIGUOUS_SESSION,
      turnId: queued.turnId,
      observedSequence: queued.providerStartSequence,
      generation: 1,
      runtimeEpoch: 'crashed-epoch',
      createdAt: DOMAIN_TIME,
    })
    const beforeCrash = await fixture.snapshot()
    useChatProjectionStore
      .getState()
      .syncShellSnapshot(fixture.descriptor.environmentId, beforeCrash)
    const events = await fixture.appendUnapplied(registered.result.projectId, 1105)
    const adapter = new MetadataProviderAdapter()
    adapter.rows = [
      {
        sessionId: TERMINAL_SESSION,
        cwd: fixture.linked,
        title: 'Terminal session',
        sourceUpdatedAt: DOMAIN_TIME,
        gitBranch: 'feature',
      },
    ]
    await fixture.server.restart({ providerRuntime: true, providerAdapter: adapter })
    const firstSnapshot = await fixture.snapshot()
    expect(firstSnapshot.snapshotSequence).toBeGreaterThanOrEqual(
      events.at(-1)?.sequence ?? Infinity,
    )
    expect(
      firstSnapshot.projects.find((project) => project.id === registered.result?.projectId)?.title,
    ).toBe('Catchup 1104')
    expect(
      firstSnapshot.sessions.find((session) => session.id === AMBIGUOUS_SESSION),
    ).toMatchObject({
      attentionState: 'needs-input',
      latestTurn: { providerStartState: 'interrupted', state: 'interrupted' },
    })
    await fixture.engine.providerRuntimeIdle()
    await fixture.engine.importSessions(DOMAIN_MODEL.providerInstanceId)
    await waitFor(async () =>
      expect(
        (await fixture.snapshot()).sessions.some((session) => session.id === TERMINAL_SESSION),
      ).toBe(true),
    )
    expect(adapter.startedTurns.map((turn) => turn.sessionId)).toEqual([DOMAIN_SESSION])
    expect(adapter.startedSessions[0]).toMatchObject({
      sessionId: DOMAIN_SESSION,
      cwd: fixture.main,
    })
    const discovered = await fixture.session(TERMINAL_SESSION)
    expect(discovered).toMatchObject({ origin: 'discovered', title: 'Terminal session' })
    expect(discovered.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'Existing terminal conversation' }),
    ])
    const importedOwner = (await fixture.engine.readModelSnapshot()).worktrees.get(
      discovered.worktreeId,
    )
    expect(importedOwner).toMatchObject({
      canonicalPath: fixture.linked,
      path: 'linked',
      ownership: 'external',
    })

    for await (const frame of fixture.engine.shellStream({
      afterSequence: beforeCrash.snapshotSequence,
    })) {
      if (frame.kind === 'synchronized') break
      useChatProjectionStore
        .getState()
        .applyShellStreamItem(fixture.descriptor.environmentId, frame)
    }
    const snapshot = await fixture.snapshot()
    const slice = useChatProjectionStore.getState().slices[fixture.descriptor.environmentId]
    expect(slice?.lastAppliedShellSequence).toBe(snapshot.snapshotSequence)
    expect(slice?.sessionIds.toSorted()).toEqual(
      snapshot.sessions.map((session) => session.id).toSorted(),
    )

    await fixture.internal({
      type: 'session.runtime.set',
      commandId: 'second-stale-runtime',
      sessionId: AMBIGUOUS_SESSION,
      createdAt: DOMAIN_TIME,
      runtime: {
        sessionId: AMBIGUOUS_SESSION,
        status: 'running',
        providerName: 'claude',
        providerInstanceId: DOMAIN_MODEL.providerInstanceId,
        providerBindingHandle: null,
        providerConversationMarker: null,
        providerResumeCursor: null,
        runtimeEpoch: 'second-crashed-epoch',
        activeTurnId: null,
        lastError: null,
        updatedAt: DOMAIN_TIME,
      },
    })
    await fixture.server.restart({ providerAdapter: new MetadataProviderAdapter() })
    await fixture.engine.providerRuntimeIdle()
    const recoveries = (
      await fixture.engine.replay({ afterSequence: events.at(-1)?.sequence ?? 0 })
    ).events.filter(
      (event) =>
        event.type === 'session.runtime-recovered' && event.payload.sessionId === AMBIGUOUS_SESSION,
    )
    expect(recoveries).toHaveLength(2)
    expect(new Set(recoveries.map((event) => event.commandId)).size).toBe(2)

    const clone = path.join(second.root, 'clone')
    await executeDomainGit(second.root, 'clone', fixture.main, clone)
    await executeDomainGit(
      clone,
      'remote',
      'set-url',
      'origin',
      'https://github.com/OpenAI/Platform.git',
    )
    const clientB = createInProcessClient(second)
    const response = await clientB.orchestration.commands.post({
      type: 'project.create',
      commandId: v.parse(commandIdSchema, 'clone-register'),
      workspaceRoot: 'clone',
      title: 'Same repository',
      defaultModelSelection: DOMAIN_MODEL,
    })
    const registrationB = v.parse(orchestrationDispatchResultSchema, response.data).result
    if (!registrationB) throw new TypeError('Missing clone registration')
    expect(registrationB.projectId).toBe(registered.result.projectId)
    expect(registrationB.worktreeId).not.toBe(registered.result.worktreeId)
    const descriptorB = v.parse(healthDescriptorSchema, (await clientB.health.get()).data)
    expect(descriptorB.environmentId).not.toBe(fixture.descriptor.environmentId)
    await clientB.orchestration.commands.post({
      type: 'session.create',
      commandId: v.parse(commandIdSchema, 'clone-session'),
      worktreeTarget: { kind: 'current', worktreeId: registrationB.worktreeId },
      sessionId: DOMAIN_SESSION,
      title: 'Other machine session',
      modelSelection: DOMAIN_MODEL,
      runtimeMode: 'full-access',
      interactionMode: 'default',
    })
    const projection = useChatProjectionStore.getState()
    projection.syncShellSnapshot(fixture.descriptor.environmentId, await fixture.snapshot())
    projection.syncShellSnapshot(
      descriptorB.environmentId,
      await fetchOrchestrationShellSnapshotHttp(clientB),
    )
    const slices = useChatProjectionStore.getState().slices
    const sliceA = slices[fixture.descriptor.environmentId]
    const sliceB = slices[descriptorB.environmentId]
    if (!sliceA || !sliceB) throw new TypeError('Missing environment slices')
    const rail = sessionRailModel({
      environments: [
        {
          environmentId: fixture.descriptor.environmentId,
          isPrimary: true,
          label: 'Desktop',
          phase: 'live',
          projects: selectChatProjects(sliceA),
          worktrees: selectChatWorktrees(sliceA),
          sessions: selectChatSessions(sliceA),
        },
        {
          environmentId: descriptorB.environmentId,
          isPrimary: false,
          label: 'Laptop',
          phase: 'live',
          projects: selectChatProjects(sliceB),
          worktrees: selectChatWorktrees(sliceB),
          sessions: selectChatSessions(sliceB),
        },
      ],
    })
    expect(rail.projects).toHaveLength(1)
    expect(
      rail.sessions
        .filter((session) => session.id === DOMAIN_SESSION)
        .map((session) => session.machineLabel)
        .toSorted(),
    ).toEqual(['Desktop', 'Laptop'])
    expect(
      rail.sections
        .find((section) => section.state === 'active')
        ?.groups[0]?.sessions.map((session) => session.id),
    ).toContain(AMBIGUOUS_SESSION)
    expect(rail.sessions.find((session) => session.id === TERMINAL_SESSION)?.worktreePath).toBe(
      'linked',
    )
  } finally {
    useChatProjectionStore.setState(previousProjection, true)
    await Promise.all([fixture.server.cleanup(), second.cleanup()])
  }
}, 30_000)

test('deletion cleanup retries from disk, preserves a shared checkout, and blocks revival while an adapter remains live', async () => {
  const fixture = await makeSessionDomainFixture({ providerRuntime: true })
  try {
    const registration = await fixture.register()
    if (!registration.result) throw new TypeError('Missing registration')
    await fixture.createSession(registration.result.worktreeId)
    await fixture.createSession(registration.result.worktreeId, AMBIGUOUS_SESSION)
    await fixture.startTurn(DOMAIN_SESSION, true)
    await fixture.engine.providerRuntimeIdle()
    expect(await readFile(fixture.blobPath, 'utf8')).toBe('abc')
    await rm(fixture.blobPath)
    await mkdir(fixture.blobPath)
    await fixture.dispatch({
      type: 'session.delete',
      commandId: 'delete-first',
      sessionId: DOMAIN_SESSION,
    })
    await fixture.engine.providerRuntimeIdle()
    expect((await fixture.session()).deletion).toMatchObject({
      providerStop: 'completed',
      blobCleanup: 'failed',
    })
    expect((await fixture.snapshot()).sessions.map((session) => session.id)).toEqual([
      AMBIGUOUS_SESSION,
    ])
    expect(await readFile(path.join(fixture.main, 'keep.txt'), 'utf8')).toBe('developer file')
    await rm(fixture.blobPath, { recursive: true })
    const stubborn = new MetadataProviderAdapter({ stopError: 'provider stop refused' })
    await fixture.server.restart({ providerAdapter: stubborn })
    await fixture.engine.ready
    expect((await fixture.session()).deletion).toMatchObject({
      providerStop: 'completed',
      blobCleanup: 'completed',
    })
    await expect(stat(fixture.blobPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await fixture.startTurn(AMBIGUOUS_SESSION)
    await fixture.engine.providerRuntimeIdle()
    await fixture.dispatch({
      type: 'project.delete',
      commandId: 'delete-project',
      projectId: registration.result.projectId,
      force: true,
    })
    await fixture.engine.providerRuntimeIdle()
    expect((await fixture.session(AMBIGUOUS_SESSION)).deletion).toMatchObject({
      providerStop: 'failed',
      blobCleanup: 'completed',
    })
    await expect(fixture.register('revival-while-live')).rejects.toMatchObject({
      name: 'TypeError',
      message: expect.stringContaining('REGISTRATION_BUSY'),
    })
    await fixture.server.restart({ providerAdapter: new MetadataProviderAdapter() })
    await fixture.engine.ready
    const revived = await fixture.register('revival-after-cleanup')
    expect(revived.result).toEqual({ ...registration.result, disposition: 'revived-project' })
    expect(await readFile(path.join(fixture.main, 'keep.txt'), 'utf8')).toBe('developer file')
    expect((await fixture.snapshot()).sessions).toEqual([])
  } finally {
    await fixture.server.cleanup()
  }
})
