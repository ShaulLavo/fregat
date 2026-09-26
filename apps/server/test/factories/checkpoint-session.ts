import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'
import {
  commandIdSchema,
  messageIdSchema,
  projectIdSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
  worktreeIdSchema,
} from '@workspace/contracts'

import * as schema from '../../src/db/schema'
import { migratePlatformDatabase } from '../../src/db/migrations'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../src/fs/limits'
import { createWorkspacePaths } from '../../src/fs/path'
import { GitService } from '../../src/git/service'
import { OrchestrationEngine } from '../../src/orchestration/engine'
import { runGit } from '../../src/testing/git'

export const checkpointSessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
const projectId = v.parse(projectIdSchema, '10000000-0000-4000-8000-000000000001')
const worktreeId = v.parse(worktreeIdSchema, '20000000-0000-4000-8000-000000000001')
const modelSelection = {
  model: 'gpt-5-codex',
  providerInstanceId: v.parse(providerInstanceIdSchema, 'codex'),
}
const now = '2026-05-29T00:00:00.000Z'

/** A temp git repository with an identity, removed by the returned cleanup. */
export async function checkpointRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-checkpoint-'))
  await runGit(root, ['init'])
  await runGit(root, ['config', 'user.email', 'test@example.com'])
  await runGit(root, ['config', 'user.name', 'Test User'])
  return { root, cleanup: () => rm(root, { force: true, recursive: true }) }
}

/** An in-memory orchestration database and engine over a git service rooted at `root`. */
export function checkpointOrchestration(root: string) {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migratePlatformDatabase(database)
  const engine = new OrchestrationEngine(database)
  const git = new GitService(createWorkspacePaths(root), {
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
  return { close: () => sqlite.close(), database, engine, git }
}

/** Registers the repository as a project with one session whose turn 1 is the given ref. */
export async function dispatchCheckpointSession(
  engine: OrchestrationEngine,
  workspaceRoot: string,
  checkpointRef: string,
  files: readonly { path: string; additions: number; deletions: number }[] = [
    { additions: 1, deletions: 1, path: 'app.txt' },
  ],
) {
  await engine.dispatch({
    worktreeId,
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
    worktreeTarget: { kind: 'current', worktreeId },
    commandId: v.parse(commandIdSchema, 'cmd-session'),
    interactionMode: 'default',
    modelSelection,
    runtimeMode: 'full-access',
    sessionId: checkpointSessionId,
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
    files: files.map((file) => ({ ...file, kind: 'modified' as const })),
    status: 'ready',
    sessionId: checkpointSessionId,
    turnId: v.parse(turnIdSchema, 'turn-1'),
    type: 'session.turn.diff.complete',
  })
}
