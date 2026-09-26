import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'
import {
  approvalRequestIdSchema,
  messageIdSchema,
  orchestrationDispatchResultSchema,
  orchestrationEventSchema,
  sessionIdSchema,
  turnIdSchema,
  orchestrationCommandSchema,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReplayEventsResult,
} from '@workspace/contracts'
import type { App } from '../../app'
import { closeTestApps, createTestApp } from '../../../test/server'
import * as schema from '../../db/schema'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../db/migrations'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../../git/service'
import { OrchestrationEventStore } from '../event-store'
import type { PendingOrchestrationEvent } from '../event-store'
import { OrchestrationEngine } from '../engine'
import { OrchestrationProjectionPipeline } from '../projection-pipeline'
import { ProviderRuntimeIngestion } from '../provider-runtime-ingestion'
import { OrchestrationSnapshotQuery } from '../snapshot-query'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../provider/provider-adapter-registry'
import { requestGone } from '../../provider/structured-errors'
import { checkpointRefForSessionTurn } from '../checkpoint-refs'
import { attachmentFilePath } from '../../attachments/store'

import { testSettingsOptions } from '../../settings/testing'
import { runGit } from '../../testing/git'

const now = '2026-05-24T00:00:00.000Z'
const later = '2026-05-24T00:01:00.000Z'
const assistantStarted = '2026-05-24T00:02:00.000Z'
const assistantCompleted = '2026-05-24T00:03:00.000Z'
const modelSelection = {
  providerInstanceId: 'codex',
  model: 'gpt-5-codex',
}
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('orchestration engine', () => {
  it('keeps image-only prompts and their blobs when the source is deleted, including another fork', async () => {
    const fixture = createFixture()
    const attachmentsDir = await fixtureRoot()
    const adapter = new MockProviderAdapter()
    const engine = new OrchestrationEngine(fixture.database, {
      attachmentsDir,
      providerRuntime: { adapterRegistry: new ProviderAdapterRegistry({ adapters: [adapter] }) },
    })
    const sourceSessionId = '00000000-0000-4000-8000-000000000001'
    const forkId = '00000000-0000-4000-8000-000000000004'
    const nextForkId = '00000000-0000-4000-8000-000000000005'
    const attachment = {
      type: 'image',
      id: 'source-image',
      name: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 4,
    } as const
    const sourceFile = attachmentFilePath({ attachmentsDir, attachment })!
    await writeFile(sourceFile, 'blob')
    try {
      await engine.dispatch(projectCreateCommand())
      await engine.dispatch(sessionCreateCommand())
      await engine.dispatch(
        command({
          ...sessionTurnStartCommand(),
          message: { messageId: 'image-prompt', role: 'user', text: '', attachments: [attachment] },
        }),
      )
      await engine.providerRuntimeIdle()
      await engine.dispatchClientCommand({
        type: 'session.fork',
        commandId: 'fork-image',
        sessionId: forkId,
        sourceSessionId,
        throughTurnId: 'turn-1',
      })
      const prompt = (await engine.sessionTranscript(forkId)).session.messages[0]!
      expect(prompt).toMatchObject({
        role: 'user',
        text: '',
        turnId: 'turn-1',
        attachments: [
          expect.objectContaining({ name: 'screenshot.png', mimeType: 'image/png', sizeBytes: 4 }),
        ],
      })
      expect(prompt.attachments[0]!.id).not.toBe(attachment.id)
      await engine.dispatchClientCommand({
        type: 'session.fork',
        commandId: 'fork-image-again',
        sessionId: nextForkId,
        sourceSessionId: forkId,
        throughTurnId: 'turn-1',
      })
      await engine.dispatchClientCommand({
        type: 'session.delete',
        commandId: 'delete-image-source',
        sessionId: sourceSessionId,
      })
      await engine.providerRuntimeIdle()
      expect(await Bun.file(sourceFile).exists()).toBe(false)
      expect(
        await readFile(
          attachmentFilePath({ attachmentsDir, attachment: prompt.attachments[0]! })!,
          'utf8',
        ),
      ).toBe('blob')
      const next = (await engine.sessionTranscript(nextForkId)).session.messages[0]!
      expect(
        await readFile(
          attachmentFilePath({ attachmentsDir, attachment: next.attachments[0]! })!,
          'utf8',
        ),
      ).toBe('blob')
    } finally {
      await engine.close()
      fixture.close()
    }
  })

  it.each(['steer', 'failed-start'] as const)(
    'forks the selected native turn after an earlier %s',
    async (earlier) => {
      const fixture = createFixture()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const adapter = Object.assign(
        new MockProviderAdapter({
          beforeComplete: async () => {
            entered.resolve()
            await release.promise
          },
        }),
        { steerTurn: async () => {} },
      )
      const sendTurn = adapter.sendTurn.bind(adapter)
      adapter.sendTurn = async (input) => {
        if (earlier === 'failed-start' && input.turnId === 'turn-1')
          throw new Error('native start rejected')
        await sendTurn(input)
      }
      const engine = createRuntimeEngine(fixture, adapter)
      const sourceSessionId = '00000000-0000-4000-8000-000000000001'
      const forkId = '00000000-0000-4000-8000-000000000003'
      try {
        await dispatchFirstSession(engine)
        if (earlier === 'steer') {
          await entered.promise
          await engine.dispatchClientCommand({
            type: 'session.turn.steer',
            commandId: 'steer-first',
            sessionId: sourceSessionId,
            turnId: 'turn-1',
            message: { messageId: 'steer-message', role: 'user', text: 'Also check tests' },
          })
        }
        release.resolve()
        await engine.providerRuntimeIdle()
        await engine.dispatch(
          sessionTurnStartCommand({ commandId: 'second', messageId: 'second', turnId: 'turn-2' }),
        )
        await engine.providerRuntimeIdle()
        await engine.dispatchClientCommand({
          type: 'session.fork',
          commandId: `fork-after-${earlier}`,
          sessionId: forkId,
          sourceSessionId,
          throughTurnId: 'turn-2',
        })
        expect((await engine.sessionTranscript(forkId)).session.forkedFrom?.native.boundaryId).toBe(
          'turn-2',
        )
      } finally {
        release.resolve()
        await engine.close()
        fixture.close()
      }
    },
  )

  it('persists the native boundary at fork creation and starts there after the source advances', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const engine = createRuntimeEngine(fixture, adapter)
    const sourceSessionId = '00000000-0000-4000-8000-000000000001'
    const forkId = '00000000-0000-4000-8000-000000000002'
    try {
      await dispatchFirstSession(engine)
      await engine.providerRuntimeIdle()
      const command = {
        type: 'session.fork',
        commandId: 'fork-before-source-advances',
        sessionId: forkId,
        sourceSessionId,
        throughTurnId: 'turn-1',
      }
      await engine.dispatchClientCommand(command)
      const native = {
        conversationId: `mock-conversation:${sourceSessionId}`,
        boundaryId: 'turn-1',
      }
      expect((await engine.sessionTranscript(forkId)).session.forkedFrom?.native).toEqual(native)
      await engine.dispatch(
        sessionTurnStartCommand({
          commandId: 'source-advances',
          messageId: 'source-second',
          turnId: 'turn-2',
        }),
      )
      await engine.providerRuntimeIdle()
      expect(await engine.dispatchClientCommand(command)).toMatchObject({ deduped: true })
      await engine.dispatch(
        sessionTurnStartCommand({
          sessionId: forkId,
          commandId: 'fork-starts',
          messageId: 'fork-first',
          turnId: 'fork-turn-1',
        }),
      )
      await engine.providerRuntimeIdle()
      expect(adapter.startedSessions.find((session) => session.sessionId === forkId)?.fork).toEqual(
        native,
      )
    } finally {
      await engine.close()
      fixture.close()
    }
  })

  it('dedupes commands by command receipt', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)

    const first = await engine.dispatch(projectCreateCommand())
    const duplicate = await engine.dispatch(projectCreateCommand())
    const replay = await engine.replay({ afterSequence: 0 })

    expect(first).toMatchObject({ deduped: false, sequence: 2 })
    expect(duplicate).toMatchObject({ deduped: true, sequence: 2 })
    // Both dispatch paths — fresh and deduped — return the wire contract and
    // nothing more. `toMatchObject` above would not notice a re-added field.
    expect([Object.keys(first).sort(), Object.keys(duplicate).sort()]).toEqual([
      ['deduped', 'result', 'sequence'],
      ['deduped', 'result', 'sequence'],
    ])
    expect(replay.events).toHaveLength(2)
    fixture.close()
  })

  it('writes a durable rejection for an invariant violation', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)

    await expect(engine.dispatch(sessionCreateCommand())).rejects.toThrow('Worktree not found')

    expect(fixture.database.select().from(schema.orchestrationCommandReceipts).all()).toMatchObject(
      [{ commandId: 'cmd-session-create', resultSequence: null, status: 'rejected' }],
    )
    await expect(engine.dispatch(sessionCreateCommand())).rejects.toMatchObject({
      code: 'orchestration.COMMAND_PREVIOUSLY_REJECTED',
    })
    expect((await engine.replay({ afterSequence: 0 })).events).toHaveLength(0)
    fixture.close()
  })

  it('rolls back a failed commit without poisoning the command id', async () => {
    const fixture = createFixture()
    fixture.sqlite.exec(`
      CREATE TRIGGER fail_projection_project_insert
      BEFORE INSERT ON projection_projects
      BEGIN
        SELECT RAISE(ABORT, 'projection failed');
      END;
    `)
    const engine = new OrchestrationEngine(fixture.database)
    const retried = projectCreateCommand({
      commandId: 'cmd-project-create-retried',
      projectId: 'c70f2f81-8bca-5362-88d2-98099bcdbf9c',
    })

    await expect(engine.dispatch(retried)).rejects.toThrow('projection failed')

    expect((await engine.replay({ afterSequence: 0 })).events).toHaveLength(0)
    expect(fixture.database.select().from(schema.orchestrationCommandReceipts).all()).toHaveLength(
      0,
    )

    fixture.sqlite.exec('DROP TRIGGER fail_projection_project_insert')

    expect(await engine.dispatch(retried)).toMatchObject({ deduped: false, sequence: 2 })
    expect(fixture.database.select().from(schema.orchestrationCommandReceipts).all()).toMatchObject(
      [{ commandId: 'cmd-project-create-retried', status: 'accepted' }],
    )
    fixture.close()
  })

  it('fans committed events out to every reactor and isolates a throwing one', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)
    const observed: OrchestrationEvent[] = []
    let throwingCalls = 0

    engine.subscribeDomainEvents({
      handleEvents: () => {
        throwingCalls += 1
        throw new TypeError('reactor exploded')
      },
      name: 'throwing',
    })
    const unsubscribe = engine.subscribeDomainEvents({
      handleEvents: (events) => observed.push(...events),
      name: 'observing',
    })

    const committed = await engine.dispatch(projectCreateCommand())
    unsubscribe()
    await engine.dispatch(sessionCreateCommand())

    expect(committed).toMatchObject({ deduped: false, sequence: 2 })
    expect(throwingCalls).toBe(2)
    expect(observed.map((event) => event.type)).toEqual(['project.created', 'worktree.registered'])
    expect((await engine.replay({ afterSequence: 0 })).events).toHaveLength(3)
    fixture.close()
  })

  it('reconciles the read model from the event log after a failed dispatch', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)
    const observed: OrchestrationEvent[] = []
    engine.subscribeDomainEvents({
      handleEvents: (events) => observed.push(...events),
      name: 'observing',
    })

    await engine.dispatch(projectCreateCommand())
    // A writer the engine never saw — the same drift a dispatch that throws
    // after its events are durable would leave behind.
    new OrchestrationEventStore(fixture.database).append([unobservedProjectCreatedEvent()])

    expect(
      (await engine.readModelSnapshot()).projects.has('7cbea174-ed3a-5f65-b016-8deac3bfb79e'),
    ).toBe(false)

    await expect(
      engine.dispatch(
        sessionCreateCommand(
          undefined,
          'cmd-missing-worktree',
          '20000000-0000-4000-8000-000000000099',
        ),
      ),
    ).rejects.toThrow('Worktree not found')

    expect(
      (await engine.readModelSnapshot()).projects.has('7cbea174-ed3a-5f65-b016-8deac3bfb79e'),
    ).toBe(true)
    expect(observed.map((event) => event.type)).toEqual([
      'project.created',
      'worktree.registered',
      'project.created',
    ])
    fixture.close()
  })

  it('allocates stream_version inside the insert so an interleaved append cannot collide', () => {
    const fixture = createFixture()
    // Fires between the two batched appends below, claiming the version the old
    // pre-computed allocation would have handed to the second event.
    fixture.sqlite.exec(`
      CREATE TRIGGER interleave_competing_event
      AFTER INSERT ON orchestration_events
      WHEN new.aggregate_id = 'e9fb6230-c710-5feb-8967-9a6cc07c9670'
      BEGIN
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, aggregate_id, stream_version, event_type,
          occurred_at, command_id, causation_event_id, correlation_id, actor_kind,
          payload_json, metadata_json
        ) VALUES (
          'event-competing-' || new.sequence, 'project', 'e9fb6230-c710-5feb-8967-9a6cc07c9670',
          (SELECT coalesce(max(stream_version), 0) + 1 FROM orchestration_events
            WHERE aggregate_kind = 'project' AND aggregate_id = 'e9fb6230-c710-5feb-8967-9a6cc07c9670'),
          'project.deleted', new.occurred_at, NULL, NULL, NULL, 'server',
          new.payload_json, new.metadata_json
        );
      END;
    `)
    const store = new OrchestrationEventStore(fixture.database)

    const appended = store.append([raceEvent('event-race-1'), raceEvent('event-race-2')])
    const versions = fixture.database
      .select({ streamVersion: schema.orchestrationEvents.streamVersion })
      .from(schema.orchestrationEvents)
      .all()
      .map((row) => row.streamVersion)
      .sort((left, right) => left - right)

    expect(appended.map((event) => event.eventId as string)).toEqual([
      'event-race-1',
      'event-race-2',
    ])
    expect(versions).toEqual([1, 2, 3, 4])
    fixture.close()
  })

  it('rebuilds the same read model from the projection rows', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)

    await dispatchFirstSession(engine)
    const rebuilt = new OrchestrationSnapshotQuery(fixture.database).fullReadModel()
    const session = rebuilt.sessions.get('00000000-0000-4000-8000-000000000001')

    expect(rebuilt.projects.get('10000000-0000-4000-8000-000000000001')?.title).toBe('Platform')
    expect(session?.latestTurn?.turnId as string).toBe('turn-1')
    expect(session?.messages[0]?.text).toBe('Build the first slice')
    expect(session).toEqual(
      (await engine.readModelSnapshot()).sessions.get('00000000-0000-4000-8000-000000000001'),
    )
    fixture.close()
  })

  it.each(['worktree.registered', 'worktree.revived'] as const)(
    'replays stored %s events that omit a retirement timestamp',
    async (type) => {
      const fixture = createFixture()
      const engine = new OrchestrationEngine(fixture.database)
      try {
        await engine.dispatch(projectCreateCommand())
        fixture.sqlite
          .query(
            "UPDATE orchestration_events SET event_type = ?, payload_json = json_remove(payload_json, '$.retiredAt') WHERE event_type = 'worktree.registered'",
          )
          .run(type)
        const stored = fixture.database.select().from(schema.orchestrationEvents).all()
        const replay = await engine.replay({ afterSequence: 0 })
        expect(replay.events).toContainEqual(
          expect.objectContaining({ type, payload: expect.objectContaining({ retiredAt: null }) }),
        )
        expect(fixture.database.select().from(schema.orchestrationEvents).all()).toEqual(stored)
      } finally {
        fixture.close()
      }
    },
  )

  it('reports malformed persisted event JSON as a structured invariant error', () => {
    const fixture = createFixture()
    const store = new OrchestrationEventStore(fixture.database)
    fixture.database
      .insert(schema.orchestrationEvents)
      .values({
        actorKind: 'client',
        aggregateId: '10000000-0000-4000-8000-000000000001',
        aggregateKind: 'project',
        causationEventId: null,
        commandId: 'cmd-project-create',
        correlationId: 'cmd-project-create',
        eventId: 'event-project-created',
        eventType: 'project.created',
        metadataJson: '{',
        occurredAt: now,
        payloadJson: JSON.stringify({
          createdAt: now,
          defaultModelSelection: null,
          projectId: '10000000-0000-4000-8000-000000000001',
          title: 'Platform',
          updatedAt: now,
          repositoryKey: 'fixture-repository',
          repositoryKind: 'directory',
          repositoryIdentity: { source: 'path', canonical: '/workspace' },
        }),
        streamVersion: 1,
      })
      .run()

    try {
      store.readAfter({ afterSequence: 0 })
    } catch (error) {
      expect(error).toMatchObject({
        code: 'orchestration.EVENT_JSON_INVALID',
        internal: { field: 'metadataJson', sequence: 1 },
        message: 'Invalid orchestration event metadataJson JSON at sequence 1',
        status: 500,
      })
      fixture.close()
      return
    }

    fixture.close()
    throw new TypeError('expected malformed event JSON to throw')
  })

  it('persists projection rows and returns shell/detail snapshots', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)

    await dispatchFirstSession(engine)
    const shell = await engine.shellSnapshot()
    const detail = await engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')

    expect(shell.snapshotSequence).toBe(5)
    expect(shell.projects).toContainEqual(
      expect.objectContaining({ id: '10000000-0000-4000-8000-000000000001' }),
    )
    const session = shell.sessions.find(
      (candidate) => candidate.id === '00000000-0000-4000-8000-000000000001',
    )

    expect(session).toMatchObject({
      latestTurn: expect.objectContaining({ state: 'running', turnId: 'turn-1' }),
    })
    // One server clock reading per command, so the user message and the turn it
    // opened land on the same instant instead of on two client-supplied ones.
    expect(session?.latestUserMessageAt).toBe(session?.latestTurn?.requestedAt)
    expect(detail.session.messages).toContainEqual(
      expect.objectContaining({ id: 'message-1', role: 'user', text: 'Build the first slice' }),
    )
    fixture.close()
  })

  it('bootstraps a draft session inside a turn-start command', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)

    await engine.dispatch(projectCreateCommand())
    const result = await engine.dispatch(
      sessionTurnStartCommand({
        bootstrapCreateSession: true,
        commandId: 'cmd-bootstrap-turn',
        sessionId: 'a43305cb-eea2-5353-870b-b01e71c0ec9c',
      }),
    )
    const replay = await engine.replay({ afterSequence: 0 })
    const detail = await engine.sessionDetailSnapshot('a43305cb-eea2-5353-870b-b01e71c0ec9c')

    expect(result).toMatchObject({ deduped: false, sequence: 5 })
    expect(replay.events.map((event) => event.type)).toEqual([
      'project.created',
      'worktree.registered',
      'session.created',
      'session.message-sent',
      'session.turn-start-requested',
    ])
    expect(detail.session.messages).toContainEqual(
      expect.objectContaining({ id: 'message-1', role: 'user', text: 'Build the first slice' }),
    )
    expect(detail.session.latestTurn).toMatchObject({ state: 'running', turnId: 'turn-1' })
    fixture.close()
  })

  it('keeps shell snapshot timestamps stable when projection is unchanged', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)

    const emptyFirst = await engine.shellSnapshot()
    const emptySecond = await engine.shellSnapshot()

    expect(emptySecond.updatedAt).toBe(emptyFirst.updatedAt)

    await engine.dispatch(projectCreateCommand())

    const projectedFirst = await engine.shellSnapshot()
    const projectedSecond = await engine.shellSnapshot()

    expect(projectedFirst.updatedAt).not.toBe(emptyFirst.updatedAt)
    expect(projectedSecond.updatedAt).toBe(projectedFirst.updatedAt)
    fixture.close()
  })

  it('catches projections up after events were already appended', () => {
    const fixture = createFixture()
    const store = new OrchestrationEventStore(fixture.database)
    const project = store.append([
      pendingEvent({
        actorKind: 'client',
        aggregateId: '10000000-0000-4000-8000-000000000001',
        aggregateKind: 'project',
        causationEventId: null,
        commandId: 'cmd-project-create',
        correlationId: 'cmd-project-create',
        eventId: 'event-project-created',
        metadata: {},
        occurredAt: now,
        payload: {
          createdAt: now,
          defaultModelSelection: null,
          projectId: '10000000-0000-4000-8000-000000000001',
          title: 'Platform',
          updatedAt: now,
          repositoryKey: 'fixture-repository',
          repositoryKind: 'directory',
          repositoryIdentity: { source: 'path', canonical: '/workspace' },
        },
        type: 'project.created',
      }),
    ])
    const snapshots = new OrchestrationSnapshotQuery(fixture.database)
    const staleSnapshot = snapshots.shellSnapshot()
    const pipeline = new OrchestrationProjectionPipeline(fixture.database, store)
    const applied = pipeline.catchUp()
    const snapshot = snapshots.shellSnapshot()

    expect(staleSnapshot.snapshotSequence).toBe(0)
    expect(applied).toEqual({ afterSequence: 0, eventCount: 1, pageCount: 1, sequence: 1 })
    expect(snapshot.snapshotSequence).toBe(project[0]!.sequence)
    expect(snapshot.projects[0]?.id as string).toBe('10000000-0000-4000-8000-000000000001')
    fixture.close()
  })

  it('settles assistant message completion in projections and the read model', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)

    await dispatchFirstSession(engine)
    await engine.dispatch(assistantDeltaCommand())
    await engine.dispatch(assistantCompleteCommand())
    const detail = await engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')
    const modelSession = (await engine.readModelSnapshot()).sessions.get(
      '00000000-0000-4000-8000-000000000001',
    )
    const assistantMessage = detail.session.messages.find((message) => message.id === 'message-2')

    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      streaming: false,
      text: 'Done',
    })
    expect(detail.session.latestTurn).toMatchObject({
      assistantMessageId: 'message-2',
      completedAt: assistantCompleted,
      state: 'completed',
      turnId: 'turn-1',
    })
    expect(modelSession?.latestTurn).toMatchObject({
      assistantMessageId: 'message-2',
      completedAt: assistantCompleted,
      state: 'completed',
    })
    fixture.close()
  })

  it('serves registration, session commands, and snapshots through HTTP', async () => {
    const fixture = createFixture()
    const root = await fixtureRoot()
    const app = createTestApp({
      auth: { allowedOrigins: ['http://localhost:5173'] },
      orchestration: { database: fixture.database },
      settings: testSettingsOptions(root),
      watch: false,
      workspaceRoot: root,
    })

    const registration = await registerHttpProject(app, root)
    await postCommand(app, sessionCreateCommand(undefined, undefined, registration.worktreeId))
    const turn = await postCommand(app, sessionTurnStartCommand())
    const shell = await getJson<{ snapshotSequence: number }>(app, '/orchestration/shell-snapshot')
    const detail = await getJson<{ session: { messages: Array<{ text: string }> } }>(
      app,
      '/orchestration/session-detail?sessionId=00000000-0000-4000-8000-000000000001',
    )
    const replay = await postJson<OrchestrationReplayEventsResult>(app, '/orchestration/replay', {
      afterSequence: 0,
      sessionId: '00000000-0000-4000-8000-000000000001',
    })

    expect(turn.sequence).toBe(5)
    expect(shell.snapshotSequence).toBe(5)
    expect(detail.session.messages[0]?.text).toBe('Build the first slice')
    expect(replay.events.map((event) => event.type)).toEqual([
      'session.created',
      'session.message-sent',
      'session.turn-start-requested',
    ])
    fixture.close()
  })

  it('serves provider snapshots through the provider adapter registry route', async () => {
    const fixture = createFixture()
    const root = await fixtureRoot()
    const adapterRegistry = new ProviderAdapterRegistry([new MockProviderAdapter()])
    const app = createTestApp({
      auth: { allowedOrigins: ['http://localhost:5173'] },
      orchestration: { database: fixture.database, providerAdapterRegistry: adapterRegistry },
      settings: testSettingsOptions(root),
      watch: false,
      workspaceRoot: root,
    })

    const providers = await getJson<{ providers: Array<{ providerInstanceId: string }> }>(
      app,
      '/providers',
    )

    expect(providers.providers).toContainEqual(
      expect.objectContaining({ providerInstanceId: 'codex' }),
    )
    fixture.close()
  })

  it('starts a provider runtime turn and projects assistant output', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ responseText: 'Runtime response' })
    const engine = createRuntimeEngine(fixture, adapter)

    await dispatchFirstSession(engine)
    await engine.providerRuntimeIdle()

    const runtime = fixture.database.select().from(schema.providerSessionRuntime).get()
    const detail = await engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')

    expect(runtime).toMatchObject({
      providerDriverKind: 'codex',
      providerInstanceId: 'codex',
      runtimeEpoch: expect.any(String),
      sessionId: '00000000-0000-4000-8000-000000000001',
    })
    expect(detail.session.runtime).toMatchObject({ status: 'ready' })
    expect(detail.session.messages).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        streaming: false,
        text: 'Runtime response',
      }),
    )
    fixture.close()
  })

  it('dedupes duplicate provider runtime events before dispatch', async () => {
    const dispatched: OrchestrationCommand[] = []
    const ingestion = new ProviderRuntimeIngestion(async (command) => {
      dispatched.push(command)
    })

    await ingestion.ingest({
      runtimeEpoch: 'fixture-runtime-epoch',
      createdAt: now,
      delta: 'one',
      eventId: 'runtime-event-1',
      messageId: v.parse(messageIdSchema, 'message-runtime'),
      sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
      turnId: v.parse(turnIdSchema, 'turn-1'),
      type: 'assistant.delta',
    })
    await ingestion.ingest({
      runtimeEpoch: 'fixture-runtime-epoch',
      createdAt: now,
      delta: 'one',
      eventId: 'runtime-event-1',
      messageId: v.parse(messageIdSchema, 'message-runtime'),
      sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
      turnId: v.parse(turnIdSchema, 'turn-1'),
      type: 'assistant.delta',
    })
    await ingestion.ingest({
      runtimeEpoch: 'fixture-runtime-epoch',
      completedAt: later,
      eventId: 'runtime-event-2',
      messageId: v.parse(messageIdSchema, 'message-runtime'),
      sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
      turnId: v.parse(turnIdSchema, 'turn-1'),
      type: 'assistant.complete',
    })
    await ingestion.ingest({
      runtimeEpoch: 'fixture-runtime-epoch',
      completedAt: later,
      eventId: 'runtime-event-2',
      messageId: v.parse(messageIdSchema, 'message-runtime'),
      sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
      turnId: v.parse(turnIdSchema, 'turn-1'),
      type: 'assistant.complete',
    })

    expect(dispatched).toMatchObject([
      { delta: 'one', type: 'session.message.assistant.delta' },
      { type: 'session.message.assistant.complete' },
    ])
  })

  it('ingests runtime proposed plans into shell projection state', async () => {
    const fixture = createFixture()
    const engine = new OrchestrationEngine(fixture.database)
    const ingestion = new ProviderRuntimeIngestion(async (command) => {
      await engine.dispatch(command)
    })

    await dispatchFirstSession(engine)
    await ingestion.ingest({
      runtimeEpoch: 'fixture-runtime-epoch',
      createdAt: assistantStarted,
      eventId: 'runtime-plan-1',
      planMarkdown: '1. Inspect runtime\n2. Patch provider',
      sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
      turnId: v.parse(turnIdSchema, 'turn-1'),
      type: 'proposed-plan.upsert',
    })
    const shell = await engine.shellSnapshot()

    expect(shell.sessions[0]).toMatchObject({
      hasActionableProposedPlan: true,
      id: '00000000-0000-4000-8000-000000000001',
    })
    fixture.close()
  })

  it('projects provider failures onto session and turn state', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ shouldFail: true })
    const engine = createRuntimeEngine(fixture, adapter)

    await dispatchFirstSession(engine)
    await engine.providerRuntimeIdle()
    const detail = await engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')

    expect(detail.session.latestTurn).toMatchObject({ state: 'error', turnId: 'turn-1' })
    expect(detail.session.runtime).toMatchObject({
      lastError: 'Mock provider failed',
      status: 'error',
    })
    expect(detail.session.activities).toContainEqual(
      expect.objectContaining({ kind: 'provider.turn.start.failed', tone: 'error' }),
    )
    fixture.close()
  })

  it('waits for in-flight provider actions when draining the runtime', async () => {
    let releaseProviderTurn = () => {}
    const providerTurnGate = new Promise<void>((resolve) => {
      releaseProviderTurn = resolve
    })
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ beforeComplete: () => providerTurnGate })
    const engine = createRuntimeEngine(fixture, adapter)
    let drained = false

    await dispatchFirstSession(engine)
    const idle = engine.providerRuntimeIdle().then(() => {
      drained = true
    })
    await Promise.resolve()

    expect(drained).toBe(false)
    releaseProviderTurn()
    await idle
    expect(drained).toBe(true)
    fixture.close()
  })

  it('routes interrupt requests to the active provider adapter', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const engine = createRuntimeEngine(fixture, adapter)

    await dispatchFirstSession(engine)
    await engine.providerRuntimeIdle()
    await engine.dispatch(
      command({
        commandId: 'cmd-turn-interrupt',
        createdAt: assistantCompleted,
        sessionId: '00000000-0000-4000-8000-000000000001',
        turnId: 'turn-1',
        type: 'session.turn.interrupt',
      }),
    )
    await engine.providerRuntimeIdle()
    const detail = await engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')

    expect(adapter.interruptedSessions).toContain(
      v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
    )
    expect(detail.session.latestTurn).toMatchObject({ state: 'interrupted', turnId: 'turn-1' })
    expect(detail.session.runtime).toMatchObject({ status: 'interrupted' })
    fixture.close()
  })

  it.each([
    { restoreFiles: true, fileContent: 'one\n' },
    { restoreFiles: false, fileContent: 'two\n' },
  ])(
    'reverts the conversation with restoreFiles=$restoreFiles',
    async ({ restoreFiles, fileContent }) => {
      const fixture = createFixture()
      const repositoryRoot = await fixtureRoot()
      await initGitRepository(repositoryRoot)
      await commitFile(repositoryRoot, 'base\n', 'base commit')
      const root = path.join(repositoryRoot, 'linked')
      await runGit(repositoryRoot, ['worktree', 'add', '--detach', root])
      // The agent's edit lands inside the turn, so the ref `CheckpointReactor`
      // captures when the turn settles is that turn's own result.
      let turnFileContent = 'one\n'
      const adapter = new MockProviderAdapter({
        beforeComplete: () => writeFile(path.join(root, 'app.txt'), turnFileContent),
      })
      const engine = new OrchestrationEngine(fixture.database, {
        providerRuntime: {
          checkpointGit: new GitService(createWorkspacePaths(root), {
            maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
          }),
          adapterRegistry: new ProviderAdapterRegistry({ adapters: [adapter] }),
        },
      })
      const turnTwoRef = checkpointRefForSessionTurn('00000000-0000-4000-8000-000000000001', 2)

      await dispatchCheckpointRuntimeSession(engine, repositoryRoot, root, () => {
        turnFileContent = 'two\n'
      })

      await engine.dispatch(
        command({
          commandId: 'cmd-checkpoint-revert',
          createdAt: assistantCompleted,
          sessionId: '00000000-0000-4000-8000-000000000001',
          turnCount: 1,
          type: 'session.checkpoint.revert',
          restoreFiles,
        }),
      )
      await engine.providerRuntimeIdle()

      const events = (await engine.replay({ afterSequence: 0 })).events
      const detail = await engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')

      expect(events.map((event) => event.type)).toContain('session.checkpoint-revert-requested')
      expect(events.at(-1)).toMatchObject({
        payload: { sessionId: '00000000-0000-4000-8000-000000000001', turnCount: 1 },
        type: 'session.reverted',
      })
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe(fileContent)
      expect(await gitRefExists(root, turnTwoRef)).toBe(false)
      expect(adapter.rollbacks).toContainEqual({
        numTurns: 1,
        sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
      })
      expect(detail.session.messages.map((message) => message.turnId)).not.toContain('turn-2')
      expect(
        Object.keys(
          (await engine.readModelSnapshot()).sessions.get('00000000-0000-4000-8000-000000000001')
            ?.checkpointByTurnId ?? {},
        ),
      ).toEqual(['turn-1'])
      fixture.close()
    },
  )

  it('projects interrupt and stop provider failures with operation-specific kinds', async () => {
    const interruptFixture = createFixture()
    const interruptAdapter = new MockProviderAdapter({ interruptError: 'interrupt failed' })
    const interruptEngine = createRuntimeEngine(interruptFixture, interruptAdapter)

    await dispatchFirstSession(interruptEngine)
    await interruptEngine.providerRuntimeIdle()
    await interruptEngine.dispatch(
      command({
        commandId: 'cmd-turn-interrupt',
        createdAt: assistantCompleted,
        sessionId: '00000000-0000-4000-8000-000000000001',
        turnId: 'turn-1',
        type: 'session.turn.interrupt',
      }),
    )
    await interruptEngine.providerRuntimeIdle()

    expect(
      (await interruptEngine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')).session
        .activities,
    ).toContainEqual(
      expect.objectContaining({
        kind: 'provider.turn.interrupt.failed',
        payload: expect.objectContaining({ commandId: 'cmd-turn-interrupt' }),
        tone: 'error',
      }),
    )
    interruptFixture.close()

    const stopFixture = createFixture()
    const stopAdapter = new MockProviderAdapter({ stopError: 'stop failed' })
    const stopEngine = createRuntimeEngine(stopFixture, stopAdapter)

    await dispatchFirstSession(stopEngine)
    await stopEngine.providerRuntimeIdle()
    await stopEngine.dispatch(
      command({
        commandId: 'cmd-session-stop',
        createdAt: assistantCompleted,
        sessionId: '00000000-0000-4000-8000-000000000001',
        type: 'session.runtime.stop',
      }),
    )
    await stopEngine.providerRuntimeIdle()

    expect(
      (await stopEngine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')).session
        .activities,
    ).toContainEqual(
      expect.objectContaining({ kind: 'provider.runtime.stop.failed', tone: 'error' }),
    )
    stopFixture.close()
  })

  it('routes approval and user-input responses to the active provider adapter', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const engine = createRuntimeEngine(fixture, adapter)
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
    const approvalRequestId = v.parse(approvalRequestIdSchema, 'approval-1')
    const userInputRequestId = v.parse(approvalRequestIdSchema, 'user-input-1')

    await dispatchFirstSession(engine)
    await engine.providerRuntimeIdle()
    await appendApprovalRequest(engine)
    await engine.dispatch(
      command({
        commandId: 'cmd-approval-respond',
        createdAt: assistantCompleted,
        decision: 'accept',
        requestId: approvalRequestId,
        sessionId,
        type: 'session.approval.respond',
      }),
    )
    await engine.dispatch(
      command({
        answers: { value: 'continue' },
        commandId: 'cmd-user-input-respond',
        createdAt: assistantCompleted,
        requestId: userInputRequestId,
        sessionId,
        type: 'session.user-input.respond',
      }),
    )
    await engine.providerRuntimeIdle()

    expect(adapter.approvalResponses).toContainEqual({
      decision: 'accept',
      requestId: approvalRequestId,
      sessionId,
    })
    expect(adapter.userInputResponses).toContainEqual({
      answers: { value: 'continue' },
      requestId: userInputRequestId,
      sessionId,
    })
    fixture.close()
  })

  it('projects stale approval and user-input responses as recoverable activities', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({
      approvalError: requestGone('approval', 'approval-1'),
      userInputError: requestGone('user-input', 'user-input-1'),
    })
    const engine = createRuntimeEngine(fixture, adapter)
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
    const approvalRequestId = v.parse(approvalRequestIdSchema, 'approval-1')
    const userInputRequestId = v.parse(approvalRequestIdSchema, 'user-input-1')

    await dispatchFirstSession(engine)
    await engine.providerRuntimeIdle()
    await appendApprovalRequest(engine)
    await engine.dispatch(
      command({
        commandId: 'cmd-stale-approval-respond',
        createdAt: assistantCompleted,
        decision: 'accept',
        requestId: approvalRequestId,
        sessionId,
        type: 'session.approval.respond',
      }),
    )
    await engine.dispatch(
      command({
        answers: { value: 'continue' },
        commandId: 'cmd-stale-user-input-respond',
        createdAt: assistantCompleted,
        requestId: userInputRequestId,
        sessionId,
        type: 'session.user-input.respond',
      }),
    )
    await engine.providerRuntimeIdle()

    const activities = (await engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001'))
      .session.activities
    expect(activities).toContainEqual(
      expect.objectContaining({
        kind: 'approval.resolved',
        payload: expect.objectContaining({
          decision: 'accept',
          requestId: 'approval-1',
          resolution: 'stale',
        }),
        summary: 'Answer not used',
        tone: 'info',
      }),
    )
    expect(activities).toContainEqual(
      expect.objectContaining({
        kind: 'provider.user-input.respond.failed',
        payload: expect.objectContaining({
          code: 'provider.REQUEST_GONE',
          detail: expect.stringContaining('Restart the turn to continue.'),
          requestId: 'user-input-1',
        }),
      }),
    )
    fixture.close()
  })
})

async function appendApprovalRequest(engine: OrchestrationEngine) {
  const sessionId = '00000000-0000-4000-8000-000000000001'
  await engine.dispatch(
    command({
      type: 'session.activity.append',
      commandId: 'cmd-approval-request',
      createdAt: assistantCompleted,
      sessionId,
      activity: {
        id: 'approval-request',
        sessionId,
        createdAt: assistantCompleted,
        kind: 'approval.requested',
        summary: 'Approval requested',
        tone: 'approval',
        turnId: null,
        payload: { requestId: 'approval-1' },
      },
    }),
  )
}

async function dispatchFirstSession(engine: OrchestrationEngine) {
  await engine.dispatch(projectCreateCommand())
  await engine.dispatch(sessionCreateCommand())
  await engine.dispatch(sessionTurnStartCommand())
}

async function dispatchCheckpointRuntimeSession(
  engine: OrchestrationEngine,
  repositoryRoot: string,
  workspaceRoot: string,
  beforeSecondTurn: () => void,
) {
  await engine.dispatch(
    command({
      ...projectCreateCommand({ workspaceRoot: repositoryRoot }),
      worktreeId: '20000000-0000-4000-8000-000000000002',
    }),
  )
  await engine.dispatch(
    command({
      type: 'worktree.register',
      commandId: 'cmd-linked-register',
      createdAt: now,
      worktreeId: '20000000-0000-4000-8000-000000000001',
      projectId: '10000000-0000-4000-8000-000000000001',
      canonicalPath: workspaceRoot,
      path: workspaceRoot,
      branch: null,
      kind: 'linked',
      ownership: 'external',
      registrationGeneration: 0,
      updatedAt: now,
    }),
  )
  await engine.dispatch(
    sessionCreateCommand('00000000-0000-4000-8000-000000000001', 'cmd-session-create-checkpoint'),
  )
  await engine.dispatch(sessionTurnStartCommand())
  await engine.providerRuntimeIdle()
  beforeSecondTurn()
  await engine.dispatch(
    sessionTurnStartCommand({
      commandId: 'cmd-turn-2-start',
      messageId: 'message-turn-2',
      text: 'Second turn',
      turnId: 'turn-2',
    }),
  )
  await engine.providerRuntimeIdle()
}

function projectCreateCommand(input: Partial<ProjectCreateFixture> = {}) {
  return command({
    worktreeId: '20000000-0000-4000-8000-000000000001',
    repositoryKey: 'fixture-repository',
    repositoryKind: 'directory',
    repositoryIdentity: { source: 'path', canonical: input.workspaceRoot ?? '/workspace' },
    canonicalPath: input.workspaceRoot ?? '/workspace',
    path: '',
    branch: null,
    registrationGeneration: 0,
    kind: 'current',
    ownership: 'protected',
    updatedAt: '2026-05-24T00:00:00.000Z',
    intentFingerprint: 'fixture-intent',
    commandId: input.commandId ?? 'cmd-project-create',
    createdAt: now,
    defaultModelSelection: null,
    projectId: input.projectId ?? '10000000-0000-4000-8000-000000000001',
    title: 'Platform',
    type: 'project.create',
    workspaceRoot: input.workspaceRoot ?? '/workspace',
  })
}

type ProjectCreateFixture = {
  commandId: string
  projectId: string
  workspaceRoot: string
}

function unobservedProjectCreatedEvent() {
  return pendingEvent({
    actorKind: 'client',
    aggregateId: '7cbea174-ed3a-5f65-b016-8deac3bfb79e',
    aggregateKind: 'project',
    causationEventId: null,
    commandId: 'cmd-project-unobserved',
    correlationId: 'cmd-project-unobserved',
    eventId: 'event-project-unobserved',
    metadata: {},
    occurredAt: now,
    payload: {
      createdAt: now,
      defaultModelSelection: null,
      projectId: '7cbea174-ed3a-5f65-b016-8deac3bfb79e',
      title: 'Unobserved',
      updatedAt: now,
      repositoryKey: 'unobserved-repository',
      repositoryKind: 'directory',
      repositoryIdentity: { source: 'path', canonical: '/unobserved' },
    },
    type: 'project.created',
  })
}

function raceEvent(eventId: string) {
  return pendingEvent({
    actorKind: 'client',
    aggregateId: 'e9fb6230-c710-5feb-8967-9a6cc07c9670',
    aggregateKind: 'project',
    causationEventId: null,
    commandId: 'cmd-project-race',
    correlationId: 'cmd-project-race',
    eventId,
    metadata: {},
    occurredAt: now,
    payload: { deletedAt: now, projectId: 'e9fb6230-c710-5feb-8967-9a6cc07c9670' },
    type: 'project.deleted',
  })
}

function sessionCreateCommand(
  sessionId = '00000000-0000-4000-8000-000000000001',
  commandId = 'cmd-session-create',
  worktreeId = '20000000-0000-4000-8000-000000000001',
) {
  return command({
    worktreeTarget: { kind: 'current', worktreeId },
    commandId,
    createdAt: now,
    interactionMode: 'default',
    modelSelection,

    runtimeMode: 'full-access',
    sessionId,
    title: 'First session',
    type: 'session.create',
  })
}

function sessionTurnStartCommand(input: Partial<SessionTurnStartFixture> = {}) {
  return command({
    bootstrap: input.bootstrapCreateSession
      ? {
          createSession: {
            worktreeTarget: { kind: 'current', worktreeId: '20000000-0000-4000-8000-000000000001' },

            createdAt: now,
            interactionMode: 'default',
            modelSelection,

            runtimeMode: 'full-access',
            title: 'First session',
          },
        }
      : undefined,
    commandId: input.commandId ?? 'cmd-turn-start',
    createdAt: later,
    interactionMode: 'default',
    message: {
      messageId: input.messageId ?? 'message-1',
      role: 'user',
      text: input.text ?? 'Build the first slice',
    },
    runtimeMode: 'full-access',
    sessionId: input.sessionId ?? '00000000-0000-4000-8000-000000000001',
    turnId: input.turnId ?? 'turn-1',
    type: 'session.turn.start',
  })
}

function assistantDeltaCommand() {
  return command({
    commandId: 'cmd-assistant-delta',
    createdAt: assistantStarted,
    delta: 'Done',
    messageId: 'message-2',
    sessionId: '00000000-0000-4000-8000-000000000001',
    turnId: 'turn-1',
    type: 'session.message.assistant.delta',
  })
}

function assistantCompleteCommand() {
  return command({
    commandId: 'cmd-assistant-complete',
    completedAt: assistantCompleted,
    messageId: 'message-2',
    sessionId: '00000000-0000-4000-8000-000000000001',
    turnId: 'turn-1',
    type: 'session.message.assistant.complete',
  })
}

type SessionTurnStartFixture = {
  bootstrapCreateSession: boolean
  commandId: string
  messageId: string
  text: string
  sessionId: string
  turnId: string
}

function command(value: unknown) {
  return v.parse(orchestrationCommandSchema, value)
}

function pendingEvent(value: Record<string, unknown>): PendingOrchestrationEvent {
  const { sequence: _sequence, ...event } = v.parse(orchestrationEventSchema, {
    ...value,
    sequence: 1,
  })
  return event
}

async function registerHttpProject(app: App, workspaceRoot: string) {
  const response = await postJson<unknown>(app, '/orchestration/commands', {
    type: 'project.create',
    commandId: 'cmd-project-create',
    title: 'Platform',
    workspaceRoot,
  })
  const receipt = v.parse(orchestrationDispatchResultSchema, response)
  if (!receipt.result) throw new TypeError('Project registration returned no worktree')
  return receipt.result
}

function createFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)

  return {
    close: () => sqlite.close(),
    database,
    sqlite,
  }
}

function createRuntimeEngine(
  fixture: ReturnType<typeof createFixture>,
  adapter: MockProviderAdapter,
) {
  return new OrchestrationEngine(fixture.database, {
    providerRuntime: { adapterRegistry: new ProviderAdapterRegistry({ adapters: [adapter] }) },
  })
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-orchestration-'))
  await mkdir(root, { recursive: true })
  roots.push(root)

  return root
}

async function initGitRepository(root: string) {
  await runGit(root, ['init'])
}

async function commitFile(root: string, content: string, message: string) {
  await writeFile(path.join(root, 'app.txt'), content)
  await runGit(root, ['add', 'app.txt'])
  await runGit(root, ['commit', '-m', message])
}

async function gitRefExists(root: string, ref: string) {
  const result = await runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    allowFailure: true,
  })

  return result.exitCode === 0
}

async function postCommand(app: App, body: OrchestrationCommand) {
  return postJson<{ sequence: number }>(app, '/orchestration/commands', body)
}

async function postJson<T>(app: App, url: string, body: unknown) {
  const response = await app.handle(
    new Request(`http://local${url}`, {
      body: JSON.stringify(body),
      headers: trustedHeaders(),
      method: 'POST',
    }),
  )

  expect(response.status).toBe(200)

  return (await response.json()) as T
}

async function getJson<T>(app: App, url: string) {
  const response = await app.handle(
    new Request(`http://local${url}`, {
      headers: trustedHeaders(),
    }),
  )

  expect(response.status).toBe(200)

  return (await response.json()) as T
}

function trustedHeaders() {
  return {
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
  }
}
