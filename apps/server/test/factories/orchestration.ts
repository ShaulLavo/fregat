import { tmpdir } from 'node:os'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { orchestrationCommandSchema, type WorktreeId } from '@workspace/contracts'
import { createMetadataDatabase } from '../../src/db/client'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../src/fs/limits'
import { createWorkspacePaths } from '../../src/fs/path'
import { GitService } from '../../src/git/service'
import {
  OrchestrationEngine,
  type OrchestrationEngineOptions,
} from '../../src/orchestration/engine'
import { MockProviderAdapter } from '../../src/provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'

export const FIXTURE_SESSION_ID = '974a8f3c-3bc1-44d1-bc82-da59e3dc6cde'
export const FIXTURE_MODEL = { providerInstanceId: 'codex', model: 'mock-model' }

export async function createOrchestrationFixture(options: { repositoryCacheTtlMs?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-domain-'))
  const checkout = path.join(root, 'checkout')
  await mkdir(checkout)
  const handle = createMetadataDatabase({ databasePath: path.join(root, 'metadata.sqlite') })
  const database = handle.db
  const sqlite = database.$client
  const paths = createWorkspacePaths(root)
  const git = new GitService(paths, {
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
    repositoryCacheTtlMs: options.repositoryCacheTtlMs,
  })
  const registration = { paths, git }
  let nextCommand = 0
  let engine = new OrchestrationEngine(database, {
    registration,
    attachmentsDir: path.join(root, 'attachments'),
  })
  await engine.ready
  const command = (input: unknown) => engine.dispatch(v.parse(orchestrationCommandSchema, input))
  return {
    root,
    checkout,
    sqlite,
    database,
    registration,
    get engine() {
      return engine
    },
    command,
    register: (workspaceRoot = checkout, commandId = `register-${++nextCommand}`) =>
      engine.dispatchClientCommand({
        type: 'project.create',
        commandId,
        workspaceRoot,
        title: 'Fixture',
        defaultModelSelection: FIXTURE_MODEL,
      }),
    createSession: (worktreeId: WorktreeId, sessionId = FIXTURE_SESSION_ID) =>
      command({
        type: 'session.create',
        commandId: `create-${++nextCommand}`,
        sessionId,
        worktreeTarget: { kind: 'current', worktreeId },
        title: 'Fixture session',
        modelSelection: FIXTURE_MODEL,
      }),
    startTurn: (sessionId: string = FIXTURE_SESSION_ID, turnId = 'turn-1') =>
      command({
        type: 'session.turn.start',
        commandId: `turn-${++nextCommand}`,
        sessionId,
        turnId,
        message: { messageId: `message-${turnId}`, role: 'user', text: 'Hello', attachments: [] },
      }),
    restart: async (providerRuntime?: OrchestrationEngineOptions['providerRuntime']) => {
      await engine.close()
      engine = new OrchestrationEngine(database, {
        registration,
        providerRuntime,
        attachmentsDir: path.join(root, 'attachments'),
      })
      return engine
    },
    close: async () => {
      await engine.close()
      handle.close()
      await rm(root, { force: true, recursive: true })
    },
  }
}

export function mockRuntime(adapter = new MockProviderAdapter()) {
  return { adapterRegistry: new ProviderAdapterRegistry({ adapters: [adapter] }) }
}

export async function executeGit(cwd: string, ...args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new TypeError(`Git fixture failed: ${stderr}`)
  return stdout.trim()
}

export async function sessionFrom(
  fixture: Awaited<ReturnType<typeof createOrchestrationFixture>>,
  sessionId: string = FIXTURE_SESSION_ID,
) {
  const session = (await fixture.engine.readModelSnapshot()).sessions.get(sessionId)
  if (!session) throw new TypeError(`Missing fixture session: ${sessionId}`)
  return session
}
