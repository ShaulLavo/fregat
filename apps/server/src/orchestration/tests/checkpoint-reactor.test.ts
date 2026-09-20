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
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../db/migrations'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../../git/service'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../provider/provider-adapter-registry'
import type { ProviderRuntimeEvent } from '../../provider/types'
import { CheckpointReactor } from '../checkpoint-reactor'
import { OrchestrationCheckpointDiffQuery } from '../checkpoint-diff-query'
import { checkpointRefForSessionTurn } from '../checkpoint-refs'
import { OrchestrationEngine } from '../engine'
import { ProviderRuntimeIngestion } from '../provider-runtime-ingestion'

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

  it('reverts the worktree to a captured turn and leaves the git index clean', async () => {
    const fixture = createFixture()
    const root = await gitFixtureRoot()
    await commitFile(root, 'app.txt', 'base\n')
    let turnContent = 'one\n'
    const adapter = new MockProviderAdapter({
      beforeComplete: async () => {
        await writeFile(path.join(root, 'app.txt'), turnContent)
        await writeFile(path.join(root, `${turnContent.trim()}.txt`), turnContent)
      },
    })
    const engine = checkpointEngine(fixture, root, adapter)

    await runTurn(engine, root)
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
      }),
    )
    await engine.providerRuntimeIdle()

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
) {
  if (turn.turnId === 'turn-1') await dispatchSession(engine, workspaceRoot)

  await engine.dispatch(turnStartCommand(turn))
  await engine.providerRuntimeIdle()
}

async function dispatchSessionWithTurn(engine: OrchestrationEngine, workspaceRoot: string) {
  await dispatchSession(engine, workspaceRoot)
  await engine.dispatch(
    turnStartCommand({ commandId: 'cmd-turn-1-start', messageId: 'message-1', turnId: 'turn-1' }),
  )
}

async function dispatchSession(engine: OrchestrationEngine, workspaceRoot: string) {
  await engine.dispatch(
    command({
      worktreeId: '20000000-0000-4000-8000-000000000001',
      repositoryKey: 'fixture-repository',
      repositoryKind: 'directory',
      repositoryIdentity: { source: 'path', canonical: workspaceRoot },
      canonicalPath: workspaceRoot,
      path: workspaceRoot,
      branch: null,
      registrationGeneration: 0,
      kind: 'current',
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
  migrateOrchestrationDatabase(database)

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
  await runGit(root, ['config', 'user.email', 'test@example.com'])
  await runGit(root, ['config', 'user.name', 'Test User'])

  return root
}

async function commitFile(root: string, file: string, content: string) {
  await writeFile(path.join(root, file), content)
  await runGit(root, ['add', file])
  await runGit(root, ['commit', '-m', `add ${file}`])
}

async function gitRefExists(root: string, ref: string) {
  const result = await runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], true)

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

async function runGit(root: string, args: readonly string[], allowFailure = false) {
  const child = Bun.spawn(['git', '-C', root].concat(args), { stderr: 'pipe', stdout: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (allowFailure || exitCode === 0) return { exitCode, stderr, stdout }

  throw new TypeError(`${stderr}${stdout}`.trim())
}
