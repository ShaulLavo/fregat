import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'
import {
  worktreeIdSchema,
  commandIdSchema,
  messageIdSchema,
  projectIdSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
} from '@workspace/contracts'

import * as schema from '../../db/schema'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../db/migrations'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../../git/service'
import { OrchestrationEngine } from '../engine'
import { OrchestrationCheckpointDiffQuery } from '../checkpoint-diff-query'
import { checkpointRefForSessionTurn } from '../checkpoint-refs'
import { runGit } from '../../testing/git'

const now = '2026-05-29T00:00:00.000Z'
const modelSelection = {
  model: 'gpt-5-codex',
  providerInstanceId: v.parse(providerInstanceIdSchema, 'codex'),
}
const projectId = v.parse(projectIdSchema, '10000000-0000-4000-8000-000000000001')
const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
const turnId = v.parse(turnIdSchema, 'turn-1')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('orchestration checkpoint diff query', () => {
  it('validates empty ranges against a real session', async () => {
    const root = await fixtureRoot()
    const sqlite = new Database(':memory:', { create: true })
    const database = drizzle({ client: sqlite, schema })
    migrateOrchestrationDatabase(database)
    const checkpointDiff = new OrchestrationCheckpointDiffQuery(
      database,
      new GitService(createWorkspacePaths(root), { maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES }),
    )

    try {
      await expect(
        checkpointDiff.turnDiff({
          fromTurnCount: 0,
          sessionId,
          toTurnCount: 0,
        }),
      ).rejects.toThrow('Session not found')
    } finally {
      sqlite.close()
    }
  })

  it('reads historical turn diffs from checkpoint refs', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    const turnZeroRef = checkpointRefForSessionTurn(sessionId, 0)
    const turnOneRef = checkpointRefForSessionTurn(sessionId, 1)

    await writeFile(path.join(root, 'app.txt'), 'before\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn zero'])
    await runGit(root, ['update-ref', turnZeroRef, 'HEAD'])
    await writeFile(path.join(root, 'app.txt'), 'after\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn one'])
    await runGit(root, ['update-ref', turnOneRef, 'HEAD'])

    const sqlite = new Database(':memory:', { create: true })
    const database = drizzle({ client: sqlite, schema })
    const engine = new OrchestrationEngine(database)
    const checkpointDiff = new OrchestrationCheckpointDiffQuery(
      database,
      new GitService(createWorkspacePaths(root), { maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES }),
    )

    try {
      await dispatchCheckpointSession(engine, root, turnOneRef)
      const diffs = await checkpointDiff.turnDiff({
        fromTurnCount: 0,
        sessionId,
        toTurnCount: 1,
      })

      expect(diffs).toMatchObject([
        {
          path: 'app.txt',
          hunks: [
            {
              changes: [
                { oldLine: 1, text: 'before', type: 'deleted' },
                { newLine: 1, text: 'after', type: 'added' },
              ],
            },
          ],
        },
      ])
      expect(diffs[0]?.oldObjectId).toEqual(expect.any(String))
      expect(diffs[0]?.newObjectId).toEqual(expect.any(String))
    } finally {
      sqlite.close()
    }
  })

  it('hides whitespace-only hunks for display and counts them by default', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    const turnZeroRef = checkpointRefForSessionTurn(sessionId, 0)
    const turnOneRef = checkpointRefForSessionTurn(sessionId, 1)

    await writeFile(path.join(root, 'app.txt'), 'before\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn zero'])
    await runGit(root, ['update-ref', turnZeroRef, 'HEAD'])
    // The only change between the refs is leading whitespace.
    await writeFile(path.join(root, 'app.txt'), '  before\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn one'])
    await runGit(root, ['update-ref', turnOneRef, 'HEAD'])

    const sqlite = new Database(':memory:', { create: true })
    const database = drizzle({ client: sqlite, schema })
    const engine = new OrchestrationEngine(database)
    const checkpointDiff = new OrchestrationCheckpointDiffQuery(
      database,
      new GitService(createWorkspacePaths(root), { maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES }),
    )

    try {
      await dispatchCheckpointSession(engine, root, turnOneRef)

      const display = await checkpointDiff.turnDiff({
        fromTurnCount: 0,
        ignoreWhitespace: true,
        sessionId,
        toTurnCount: 1,
      })
      expect(display).toEqual([])

      const honest = await checkpointDiff.turnDiff({
        fromTurnCount: 0,
        sessionId,
        toTurnCount: 1,
      })
      expect(honest).toHaveLength(1)
    } finally {
      sqlite.close()
    }
  })
})

async function dispatchCheckpointSession(
  engine: OrchestrationEngine,
  workspaceRoot: string,
  checkpointRef: string,
) {
  await engine.dispatch({
    worktreeId: v.parse(worktreeIdSchema, '20000000-0000-4000-8000-000000000001'),
    repositoryKey: 'fixture-repository',
    repositoryKind: 'directory',
    repositoryIdentity: { source: 'path', canonical: workspaceRoot },
    canonicalPath: workspaceRoot,
    path: workspaceRoot,
    branch: null,
    registrationGeneration: 0,
    kind: 'current',
    ownership: 'protected',
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    intentFingerprint: 'fixture-intent',
    commandId: v.parse(commandIdSchema, 'cmd-project'),
    defaultModelSelection: modelSelection,
    projectId,
    title: 'Platform',
    type: 'project.create',
    workspaceRoot,
  })
  await engine.dispatch({
    worktreeTarget: {
      kind: 'current',
      worktreeId: v.parse(worktreeIdSchema, '20000000-0000-4000-8000-000000000001'),
    },

    commandId: v.parse(commandIdSchema, 'cmd-session'),
    interactionMode: 'default',
    modelSelection,
    runtimeMode: 'full-access',
    sessionId,
    title: 'Session',
    type: 'session.create',
  })
  await engine.dispatch({
    assistantMessageId: v.parse(messageIdSchema, 'message-2'),
    checkpointRef,
    checkpointTurnCount: 1,
    commandId: v.parse(commandIdSchema, 'cmd-turn-diff'),
    completedAt: now,
    createdAt: now,
    files: [{ additions: 1, deletions: 1, kind: 'modified', path: 'app.txt' }],
    status: 'ready',
    sessionId,
    turnId,
    type: 'session.turn.diff.complete',
  })
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-checkpoint-diff-'))
  roots.push(root)
  await mkdir(root, { recursive: true })

  return root
}

async function initGitRepository(root: string) {
  await runGit(root, ['init'])
}
