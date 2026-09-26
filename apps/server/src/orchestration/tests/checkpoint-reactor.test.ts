import { createInternalError } from '../../observability/structured-errors'
import { OrchestrationSnapshotQuery } from '../snapshot-query'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'
import { afterEach, describe, expect, it } from 'vitest'
import {
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type ProviderInstanceId,
  orchestrationCommandSchema,
  type OrchestrationCommand,
} from '@workspace/contracts'

import * as schema from '../../db/schema'
import { initializePlatformDatabase } from '../../db/initialize'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../../git/service'
import { MockProviderAdapter, MOCK_ADAPTER_CAPABILITIES } from '../../provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../provider/provider-adapter-registry'
import type { ProviderRuntimeEvent } from '../../provider/types'
import { CheckpointReactor } from '../checkpoint-reactor'
import { OrchestrationCheckpointDiffQuery } from '../checkpoint-diff-query'
import { checkpointRefForSessionTurn } from '../checkpoint-refs'
import { OrchestrationEngine } from '../engine'
import { ProviderRuntimeIngestion } from '../provider-runtime-ingestion'
import { runGit } from '../../testing/git'

const now = '2026-06-01T00:00:00.000Z'
const later = '2026-06-01T00:01:00.000Z'
const providerInstanceId = v.parse(providerInstanceIdSchema, 'codex')
const modelSelection = { model: 'gpt-5-codex', providerInstanceId }
const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
const turnOneId = v.parse(turnIdSchema, 'turn-1')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('checkpoint reactor', () => {
  it('captures a turn-zero baseline before the first turn touches the worktree', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    const engine = checkpointEngine(fixture, root, new MockProviderAdapter())

    await runTurn(engine, root)

    expect(await gitRefExists(root, checkpointRefForSessionTurn(sessionId, 0))).toBe(true)
    expect(await gitShow(root, `${checkpointRefForSessionTurn(sessionId, 0)}:app.txt`)).toBe(
      'base\n',
    )
    fixture.close()
  })

  it('captures the turn ref and carries the files the turn actually changed', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    const adapter = new MockProviderAdapter({
      beforeComplete: async () => {
        await writeFile(path.join(root, 'app.txt'), 'base\nagent\n')
        await writeFile(path.join(root, 'added.txt'), 'new\n')
      },
    })
    const engine = checkpointEngine(fixture, root, adapter)

    await runTurn(engine, root)

    const checkpoint = (await engine.readModelSnapshot()).sessions.get(sessionId)
      ?.checkpointByTurnId[turnOneId]
    expect(checkpoint).toMatchObject({
      checkpointRef: checkpointRefForSessionTurn(sessionId, 1),
      checkpointTurnCount: 1,
      status: 'ready',
    })
    expect(await gitRefExists(root, checkpointRefForSessionTurn(sessionId, 1))).toBe(true)
    expect(await turnDiffFiles(engine)).toEqual([
      { additions: 1, deletions: 0, kind: 'added', path: 'added.txt' },
      { additions: 1, deletions: 0, kind: 'modified', path: 'app.txt' },
    ])
    fixture.close()
  })

  it('serves the captured refs to the turn diff route', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    const adapter = new MockProviderAdapter({
      beforeComplete: () => writeFile(path.join(root, 'app.txt'), 'agent\n'),
    })
    const engine = checkpointEngine(fixture, root, adapter)

    await runTurn(engine, root)

    const diffQuery = new OrchestrationCheckpointDiffQuery(
      fixture.database,
      new GitService(createWorkspacePaths(root), { maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES }),
    )
    const diffs = await diffQuery.turnDiff({ fromTurnCount: 0, sessionId, toTurnCount: 1 })

    expect(diffs).toMatchObject([
      {
        hunks: [
          {
            changes: [
              { text: 'base', type: 'deleted' },
              { text: 'agent', type: 'added' },
            ],
          },
        ],
        path: 'app.txt',
      },
    ])
    fixture.close()
  })

  it('upgrades a mid-turn placeholder and refuses to downgrade it afterwards', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    const engine = new OrchestrationEngine(fixture.database)
    const reactor = standaloneCheckpointReactor(fixture, engine, root)
    engine.subscribeDomainEvents(reactor)
    const ingestion = new ProviderRuntimeIngestion((command) => engine.dispatch(command), {
      getReadModel: () => new OrchestrationSnapshotQuery(fixture.database).fullReadModel(),
    })

    await dispatchSessionWithTurn(engine, root)
    await reactor.drain()
    await ingestion.ingest(turnStartedEvent())
    await writeFile(path.join(root, 'app.txt'), 'base\nagent\n')
    await ingestion.ingest(turnDiffUpdatedEvent('diff-1'))

    const placeholder = await checkpointForTurn(engine)
    expect(placeholder).toMatchObject({
      checkpointRef: checkpointRefForSessionTurn(sessionId, 1),
      checkpointTurnCount: 1,
      status: 'missing',
    })
    expect(await turnDiffFiles(engine)).toEqual([
      { additions: 1, deletions: 0, kind: 'modified', path: 'app.txt' },
    ])

    await ingestion.ingest(turnCompletedEvent())
    await reactor.drain()

    expect(await checkpointForTurn(engine)).toMatchObject({
      checkpointRef: checkpointRefForSessionTurn(sessionId, 1),
      // The placeholder's slot is reused: a second slot would leave the diff
      // routes asking git for a turn that was never captured.
      checkpointTurnCount: 1,
      status: 'ready',
    })
    expect(await gitRefExists(root, checkpointRefForSessionTurn(sessionId, 1))).toBe(true)

    await ingestion.ingest(turnDiffUpdatedEvent('diff-late'))
    await reactor.drain()

    expect((await checkpointForTurn(engine))?.status).toBe('ready')
    fixture.close()
  })

  it('skips a replayed event instead of photographing the worktree twice', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    const engine = new OrchestrationEngine(fixture.database)
    const reactor = standaloneCheckpointReactor(fixture, engine, root)
    engine.subscribeDomainEvents(reactor)

    await dispatchSessionWithTurn(engine, root)
    await reactor.drain()

    const baselineRef = checkpointRefForSessionTurn(sessionId, 0)
    const captured = await gitRevParse(root, baselineRef)
    // The same committed batch, redelivered — exactly what the engine does when
    // a later dispatch throws after its events were durable.
    reactor.handleEvents((await engine.replay({ afterSequence: 0 })).events)
    await writeFile(path.join(root, 'app.txt'), 'drifted\n')
    await reactor.drain()

    expect(await gitRevParse(root, baselineRef)).toBe(captured)
    fixture.close()
  })

  it('finishes the turn when the workspace has no git repository to capture', async () => {
    const fixture = createFixture()
    const root = await fixtureRoot()
    const engine = checkpointEngine(fixture, root, new MockProviderAdapter())

    await runTurn(engine, root)

    const session = (await engine.readModelSnapshot()).sessions.get(sessionId)
    expect(session?.latestTurn).toMatchObject({ state: 'completed', turnId: turnOneId })
    expect(session?.checkpointByTurnId).toEqual({})
    expect(session?.messages.some((message) => message.role === 'assistant')).toBe(true)
    fixture.close()
  })

  it('rewinds conversation only without changing shared checkout bytes or index', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    const adapter = new MockProviderAdapter({
      beforeComplete: () => writeFile(path.join(root, 'app.txt'), 'agent\n'),
    })
    const engine = checkpointEngine(fixture, root, adapter)
    await runTurn(engine, root)
    await writeFile(path.join(root, 'app.txt'), 'staged\n')
    await runGit(root, ['add', 'app.txt'])
    await writeFile(path.join(root, 'app.txt'), 'unstaged\n')
    await writeFile(path.join(root, 'untracked.txt'), 'preserve\n')
    const beforeIndex = await gitShow(root, ':app.txt')
    await engine.dispatch(
      command({
        type: 'session.checkpoint.revert',
        commandId: 'conversation-only',
        sessionId,
        turnCount: 0,
        restoreFiles: false,
      }),
    )
    await engine.providerRuntimeIdle()
    expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('unstaged\n')
    expect(await readFile(path.join(root, 'untracked.txt'), 'utf8')).toBe('preserve\n')
    expect(await gitShow(root, ':app.txt')).toBe(beforeIndex)
    expect(adapter.rollbacks).toEqual([{ sessionId, numTurns: 1 }])
    expect((await engine.readModelSnapshot()).sessions.get(sessionId)?.messages).toEqual([])
    fixture.close()
  })

  it('refuses shared-checkout file restore before changing files or provider history', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    const adapter = new MockProviderAdapter({
      beforeComplete: () => writeFile(path.join(root, 'app.txt'), 'agent\n'),
    })
    const engine = checkpointEngine(fixture, root, adapter)
    await runTurn(engine, root)
    const before = (await engine.readModelSnapshot()).sessions.get(sessionId)?.messages
    await engine.dispatch(
      command({
        type: 'session.checkpoint.revert',
        commandId: 'shared-restore',
        sessionId,
        turnCount: 0,
        restoreFiles: true,
      }),
    )
    await engine.providerRuntimeIdle()
    expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('agent\n')
    expect(adapter.rollbacks).toEqual([])
    expect((await engine.readModelSnapshot()).sessions.get(sessionId)?.messages).toEqual(before)
    expect(await gitRefExists(root, checkpointRefForSessionTurn(sessionId, 1))).toBe(true)
    fixture.close()
  })

  it.each(['unsupported', 'missing-runtime'] as const)(
    'rejects %s rollback before changing files or history',
    async (failure) => {
      const fixture = createFixture()
      const root = await gitFixtureRoot()
      await commitFile(root, 'app.txt', 'base\n')
      class UnsupportedRollbackAdapter extends MockProviderAdapter {
        override readonly capabilities = {
          ...MOCK_ADAPTER_CAPABILITIES,
          conversationRollback: false,
        }
      }
      const adapter =
        failure === 'unsupported' ? new UnsupportedRollbackAdapter() : new MockProviderAdapter()
      const engine = checkpointEngine(fixture, root, adapter)
      await runTurn(engine, root)
      if (failure === 'missing-runtime') await adapter.stopRuntime({ sessionId })
      await writeFile(path.join(root, 'app.txt'), 'local edit\n')
      await runGit(root, ['add', 'app.txt'])
      const before = await engine.sessionDetailSnapshot(sessionId)
      await engine.dispatch(
        command({
          type: 'session.checkpoint.revert',
          commandId: 'revert-rejected',
          createdAt: later,
          sessionId,
          turnCount: 0,
          restoreFiles: true,
        }),
      )
      await engine.providerRuntimeIdle()
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('local edit\n')
      expect(await gitShow(root, ':app.txt')).toBe('local edit\n')
      expect(adapter.rollbacks).toEqual([])
      const after = await engine.sessionDetailSnapshot(sessionId)
      expect(after.session.messages).toEqual(before.session.messages)
      expect(after.session.activities).toContainEqual(
        expect.objectContaining({
          kind: 'checkpoint.revert.failed',
          payload: expect.objectContaining({
            detail: expect.stringMatching(
              failure === 'unsupported' ? /cannot rewind/i : /runtime/i,
            ),
          }),
        }),
      )
      fixture.close()
    },
  )

  it.each([false, true])(
    'rejects file restore when another session shares a linked checkout, archived=%s',
    async (archived) => {
      const fixture = createFixture()
      const root = await linkedGitFixtureRoot()
      const adapter = new MockProviderAdapter()
      const engine = checkpointEngine(fixture, root, adapter)
      await runTurn(engine, root, undefined, 'linked')
      const other = '00000000-0000-4000-8000-000000000002'
      await engine.dispatch(
        command({
          type: 'session.create',
          commandId: 'create-other',
          createdAt: now,
          sessionId: other,
          title: 'Other session',
          modelSelection,
          worktreeTarget: { kind: 'current', worktreeId: '20000000-0000-4000-8000-000000000001' },
        }),
      )
      if (archived)
        await engine.dispatch(
          command({
            type: 'session.archive',
            commandId: 'archive-other',
            createdAt: later,
            sessionId: other,
          }),
        )
      await writeFile(path.join(root, 'app.txt'), 'other session edit\n')
      await engine.dispatch(
        command({
          type: 'session.checkpoint.revert',
          commandId: 'reject-shared-linked',
          createdAt: later,
          sessionId,
          turnCount: 0,
          restoreFiles: true,
        }),
      )
      await engine.providerRuntimeIdle()
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('other session edit\n')
      expect(adapter.rollbacks).toEqual([])
      expect((await engine.readModelSnapshot()).sessions.get(sessionId)?.activities).toContainEqual(
        expect.objectContaining({ kind: 'checkpoint.revert.failed' }),
      )
      fixture.close()
    },
  )

  it('preserves files and index when native rewind preparation cannot find the boundary', async () => {
    const fixture = createFixture()
    const root = await linkedGitFixtureRoot()
    class MissingBoundaryAdapter extends MockProviderAdapter {
      override async prepareRollbackSession(): Promise<() => Promise<void>> {
        throw createInternalError('Native rewind boundary is unavailable.')
      }
    }
    const adapter = new MissingBoundaryAdapter()
    const engine = checkpointEngine(fixture, root, adapter)
    await runTurn(engine, root, undefined, 'linked')
    await writeFile(path.join(root, 'app.txt'), 'staged edit\n')
    await runGit(root, ['add', 'app.txt'])
    await writeFile(path.join(root, 'app.txt'), 'unstaged edit\n')
    const before = await engine.sessionDetailSnapshot(sessionId)
    await engine.dispatch(
      command({
        type: 'session.checkpoint.revert',
        commandId: 'missing-boundary',
        createdAt: later,
        sessionId,
        turnCount: 0,
        restoreFiles: true,
      }),
    )
    await engine.providerRuntimeIdle()
    expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('unstaged edit\n')
    expect(await gitShow(root, ':app.txt')).toBe('staged edit\n')
    expect(adapter.rollbacks).toEqual([])
    const after = await engine.sessionDetailSnapshot(sessionId)
    expect(after.session.messages).toEqual(before.session.messages)
    expect(after.session.activities).toContainEqual(
      expect.objectContaining({ kind: 'checkpoint.revert.failed' }),
    )
    expect(await gitRefExists(root, checkpointRefForSessionTurn(sessionId, 1))).toBe(true)
    fixture.close()
  })

  it.each([false, true])(
    'reports provider rejection after preflight without pruning history, restoreFiles=%s',
    async (restoreFiles) => {
      const fixture = createFixture()
      const root = await linkedGitFixtureRoot()
      class RejectingRollbackAdapter extends MockProviderAdapter {
        override async prepareRollbackSession() {
          return async () => {
            throw createInternalError('Native rewind rejected after preflight.')
          }
        }
      }
      const engine = checkpointEngine(fixture, root, new RejectingRollbackAdapter())
      await runTurn(engine, root, undefined, 'linked')
      await writeFile(path.join(root, 'app.txt'), 'developer edit\n')
      const before = await engine.sessionDetailSnapshot(sessionId)
      await engine.dispatch(
        command({
          type: 'session.checkpoint.revert',
          commandId: 'native-reject',
          createdAt: later,
          sessionId,
          turnCount: 0,
          restoreFiles,
        }),
      )
      await engine.providerRuntimeIdle()
      expect((await engine.sessionDetailSnapshot(sessionId)).session.messages).toEqual(
        before.session.messages,
      )
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe(
        restoreFiles ? 'base\n' : 'developer edit\n',
      )
      expect(await gitRefExists(root, checkpointRefForSessionTurn(sessionId, 1))).toBe(true)
      expect((await engine.readModelSnapshot()).sessions.get(sessionId)?.activities).toContainEqual(
        expect.objectContaining({ kind: 'checkpoint.revert.failed' }),
      )
      fixture.close()
    },
  )

  it('reverts the worktree to a captured turn and leaves the git index clean', async () => {
    const fixture = createFixture()
    const root = await linkedGitFixtureRoot()
    let turnContent = 'one\n'
    const adapter = new MockProviderAdapter({
      beforeComplete: async () => {
        await writeFile(path.join(root, 'app.txt'), turnContent)
        await writeFile(path.join(root, `${turnContent.trim()}.txt`), turnContent)
      },
    })
    const engine = checkpointEngine(fixture, root, adapter)

    await runTurn(engine, root, undefined, 'linked')
    turnContent = 'two\n'
    await runTurn(engine, root, {
      commandId: 'cmd-turn-2-start',
      messageId: 'message-2',
      turnId: 'turn-2',
    })
    await engine.dispatch(
      command({
        commandId: 'cmd-revert',
        createdAt: later,
        sessionId,
        turnCount: 1,
        type: 'session.checkpoint.revert',
        restoreFiles: true,
      }),
    )
    await engine.providerRuntimeIdle()

    expect(
      (await engine.readModelSnapshot()).sessions
        .get(sessionId)
        ?.activities.filter((activity) => activity.kind === 'checkpoint.revert.failed'),
    ).toEqual([])
    expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('one\n')
    expect(await gitRefExists(root, checkpointRefForSessionTurn(sessionId, 2))).toBe(false)
    expect(await stagedStatusEntries(root)).toEqual([])
    expect(adapter.rollbacks).toContainEqual({ numTurns: 1, sessionId })
    fixture.close()
  })
})

function checkpointEngine(
  fixture: ReturnType<typeof createFixture>,
  root: string,
  adapter: MockProviderAdapter,
) {
  return new OrchestrationEngine(fixture.database, {
    providerRuntime: {
      adapterRegistry: new ProviderAdapterRegistry({ adapters: [adapter] }),
      checkpointGit: new GitService(createWorkspacePaths(root), {
        maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
      }),
    },
  })
}

function standaloneCheckpointReactor(
  fixture: ReturnType<typeof createFixture>,
  engine: OrchestrationEngine,
  root: string,
) {
  return new CheckpointReactor({
    dispatch: (command) => engine.dispatch(command),
    getReadModel: () => new OrchestrationSnapshotQuery(fixture.database).fullReadModel(),
    git: new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
    }),
  })
}

async function runTurn(
  engine: OrchestrationEngine,
  workspaceRoot: string,
  turn: { commandId: string; messageId: string; turnId: string } = {
    commandId: 'cmd-turn-1-start',
    messageId: 'message-1',
    turnId: 'turn-1',
  },
  worktreeKind: 'current' | 'linked' = 'current',
) {
  if (turn.turnId === 'turn-1') await dispatchSession(engine, workspaceRoot, worktreeKind)

  await engine.dispatch(turnStartCommand(turn))
  await engine.providerRuntimeIdle()
}

async function dispatchSessionWithTurn(engine: OrchestrationEngine, workspaceRoot: string) {
  await dispatchSession(engine, workspaceRoot)
  await engine.dispatch(
    turnStartCommand({ commandId: 'cmd-turn-1-start', messageId: 'message-1', turnId: 'turn-1' }),
  )
}

async function dispatchSession(
  engine: OrchestrationEngine,
  workspaceRoot: string,
  kind: 'current' | 'linked' = 'current',
) {
  const currentId =
    kind === 'linked'
      ? '20000000-0000-4000-8000-000000000002'
      : '20000000-0000-4000-8000-000000000001'
  await engine.dispatch(
    command({
      worktreeId: currentId,
      repositoryKey: 'fixture-repository',
      repositoryKind: 'directory',
      repositoryIdentity: { source: 'path', canonical: workspaceRoot },
      canonicalPath: kind === 'linked' ? path.dirname(workspaceRoot) : workspaceRoot,
      path: workspaceRoot,
      branch: null,
      registrationGeneration: 0,
      kind,
      ownership: 'protected',
      updatedAt: '2026-05-24T00:00:00.000Z',
      intentFingerprint: 'fixture-intent',
      commandId: 'cmd-project-create',
      createdAt: now,
      defaultModelSelection: modelSelection,
      projectId: '10000000-0000-4000-8000-000000000001',
      title: 'Platform',
      type: 'project.create',
      workspaceRoot,
    }),
  )
  if (kind === 'linked')
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
    command({
      worktreeTarget: { kind: 'current', worktreeId: '20000000-0000-4000-8000-000000000001' },

      commandId: 'cmd-session-create',
      createdAt: now,
      interactionMode: 'default',
      modelSelection,

      runtimeMode: 'full-access',
      sessionId,
      title: 'Session',
      type: 'session.create',
    }),
  )
}

function turnStartCommand(turn: { commandId: string; messageId: string; turnId: string }) {
  return command({
    commandId: turn.commandId,
    createdAt: later,
    interactionMode: 'default',
    message: { messageId: turn.messageId, role: 'user', text: 'Build it' },
    modelSelection,
    runtimeMode: 'full-access',
    sessionId,
    turnId: turn.turnId,
    type: 'session.turn.start',
  })
}

function turnStartedEvent(): ProviderRuntimeEvent {
  return {
    createdAt: later,
    eventId: 'runtime-turn-started',
    payload: { model: modelSelection.model },
    providerInstanceId: providerInstanceId as ProviderInstanceId,
    providerBindingHandle: 'mock:session-1',
    sessionId,
    turnId: turnOneId,
    runtimeEpoch: 'epoch-fixture',
    type: 'turn.started',
  }
}

function turnCompletedEvent(): ProviderRuntimeEvent {
  return {
    createdAt: later,
    eventId: 'runtime-turn-completed',
    payload: { state: 'completed' },
    providerInstanceId: providerInstanceId as ProviderInstanceId,
    providerBindingHandle: 'mock:session-1',
    sessionId,
    turnId: turnOneId,
    runtimeEpoch: 'epoch-fixture',
    type: 'turn.completed',
  }
}

function turnDiffUpdatedEvent(eventId: string): ProviderRuntimeEvent {
  return {
    createdAt: later,
    eventId,
    payload: {
      unifiedDiff: [
        'diff --git a/app.txt b/app.txt',
        'index 1111111..2222222 100644',
        '--- a/app.txt',
        '+++ b/app.txt',
        '@@ -1 +1,2 @@',
        ' base',
        '+agent',
        '',
      ].join('\n'),
    },
    providerInstanceId: providerInstanceId as ProviderInstanceId,
    sessionId,
    turnId: turnOneId,
    runtimeEpoch: 'epoch-fixture',
    type: 'turn.diff.updated',
  }
}

async function checkpointForTurn(engine: OrchestrationEngine) {
  return (await engine.readModelSnapshot()).sessions.get(sessionId)?.checkpointByTurnId[turnOneId]
}

async function turnDiffFiles(engine: OrchestrationEngine) {
  const events = (await engine.replay({ afterSequence: 0 })).events
  const completed = events.filter((event) => event.type === 'session.turn-diff-completed')
  const files = completed.at(-1)?.payload.files ?? []

  return [...files].toSorted((left, right) => left.path.localeCompare(right.path))
}

function command(value: unknown) {
  return v.parse(orchestrationCommandSchema, value) as OrchestrationCommand
}

function createFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  initializePlatformDatabase(database)

  return { close: () => sqlite.close(), database }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-checkpoint-reactor-'))
  await mkdir(root, { recursive: true })
  roots.push(root)

  return root
}

async function gitFixtureRoot() {
  const root = await fixtureRoot()
  await runGit(root, ['init'])

  return root
}

async function linkedGitFixtureRoot() {
  const root = await gitFixtureRoot()
  await commitFile(root, 'app.txt', 'base\n')
  const linked = path.join(await fixtureRoot(), 'isolated')
  await runGit(root, ['worktree', 'add', '--detach', linked])
  return linked
}

async function commitFile(root: string, file: string, content: string) {
  await writeFile(path.join(root, file), content)
  await runGit(root, ['add', file])
  await runGit(root, ['commit', '-m', `add ${file}`])
}

async function gitRefExists(root: string, ref: string) {
  const result = await runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    allowFailure: true,
  })

  return result.exitCode === 0
}

async function gitRevParse(root: string, ref: string) {
  const result = await runGit(root, ['rev-parse', `${ref}^{commit}`])

  return result.stdout.trim()
}

async function gitShow(root: string, revision: string) {
  const result = await runGit(root, ['show', revision])

  return result.stdout
}

/** Porcelain marks the index in column one, so anything but a space is staged. */
async function stagedStatusEntries(root: string) {
  const result = await runGit(root, ['status', '--porcelain'])

  return result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .filter((line) => line[0] !== ' ' && line[0] !== '?')
}
