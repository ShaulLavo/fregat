import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync } from 'node:fs'
import { migratePlatformDatabase } from '../../src/db/migrations'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { worktreeIdSchema, sessionIdSchema } from '@workspace/contracts'
import { createTestApp, createTestDatabase } from '../server'
import { closeApp, orchestrationForApp } from '../../src/app'
import { MockProviderAdapter } from '../../src/provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'
import { OrchestrationEngine } from '../../src/orchestration/engine'
import { GitService } from '../../src/git/service'
import { GitWorktreeService } from '../../src/git/worktrees'
import { createWorkspacePaths } from '../../src/fs/path'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../src/fs/limits'
import { executeGit, FIXTURE_MODEL } from './orchestration'

export const lifecycleWorktreeId = v.parse(worktreeIdSchema, '11111111-1111-4111-8111-111111111169')
export const lifecycleSessionId = v.parse(sessionIdSchema, '22222222-2222-4222-8222-222222222269')
export const sharedSessionId = v.parse(sessionIdSchema, '33333333-3333-4333-8333-333333333369')

export async function worktreeLifecycleFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-lifecycle-'))
  await executeGit(root, 'init', '-b', 'main')
  await executeGit(root, 'config', 'user.name', 'Lifecycle Test')
  await executeGit(root, 'config', 'user.email', 'lifecycle@example.invalid')
  await writeFile(path.join(root, 'tracked.txt'), 'initial\n')
  await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n')
  await executeGit(root, 'add', '.')
  await executeGit(root, 'commit', '-m', 'initial')
  const database = createTestDatabase()
  migratePlatformDatabase(database.db)
  let adapter = new MockProviderAdapter()
  const build = () =>
    createTestApp({
      workspaceRoot: root,
      workspaceEditJournalRoot: path.join(root, '.git', 'journal'),
      settings: { userFilePath: path.join(root, '.git', 'settings.json') },
      orchestration: {
        database: database.db,
        providerRuntime: true,
        attachmentsDir: path.join(root, '.git', 'attachments'),
        providerAdapterRegistry: new ProviderAdapterRegistry({ adapters: [adapter] }),
      },
    })
  let app = build()
  let engine = orchestrationForApp(app)
  const registered = await engine.dispatchClientCommand({
    type: 'project.create',
    commandId: 'lifecycle-project',
    title: 'Lifecycle',
    workspaceRoot: root,
    defaultModelSelection: FIXTURE_MODEL,
  })
  if (!registered.result) throw new TypeError('Missing registration result')
  const registration = registered.result
  let sequence = 0
  return {
    root,
    database,
    registration,
    get engine() {
      return engine
    },
    get app() {
      return app
    },
    get adapter() {
      return adapter
    },
    create: async (sessionId = lifecycleSessionId) => {
      await engine.dispatchClientCommand({
        type: 'session.turn.start',
        commandId: `lifecycle-create-${++sequence}`,
        sessionId,
        turnId: `turn-${sequence}`,
        message: {
          messageId: `message-${sequence}`,
          role: 'user',
          text: 'Implement the change',
          attachments: [],
        },
        bootstrap: {
          createSession: {
            worktreeTarget: {
              kind: 'new',
              worktreeId: lifecycleWorktreeId,
              baseWorktreeId: registration.worktreeId,
            },
            title: 'Isolated session',
            modelSelection: FIXTURE_MODEL,
          },
        },
      })
      await engine.providerRuntimeIdle()
      const worktree = (await engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)
      if (!worktree) throw new TypeError('Missing provisioned worktree')
      return worktree
    },
    command: async (command: Record<string, unknown>) =>
      engine.dispatchClientCommand({ commandId: `lifecycle-command-${++sequence}`, ...command }),
    restart: async () => {
      await closeApp(app)
      adapter = new MockProviderAdapter()
      app = build()
      engine = orchestrationForApp(app)
      await engine.ready
      await engine.providerRuntimeIdle()
    },
    dispose: async () => {
      await closeApp(app)
      await rm(root, { recursive: true, force: true })
    },
  }
}

export function interruptProvisioning(
  fixture: Awaited<ReturnType<typeof worktreeLifecycleFixture>>,
) {
  return fixture.engine.subscribeDomainEvents({
    name: 'test-provisioning-disk-collision',
    handleEvents: (events) => {
      const requested = events.find((event) => event.type === 'worktree.create-requested')
      if (requested?.type !== 'worktree.create-requested') return
      mkdirSync(path.dirname(requested.payload.canonicalPath), { recursive: true })
      writeFileSync(requested.payload.canonicalPath, 'creation interrupted')
    },
  })
}

export async function stopLifecycleEffects(
  fixture: Awaited<ReturnType<typeof worktreeLifecycleFixture>>,
) {
  await closeApp(fixture.app)
  const engine = new OrchestrationEngine(fixture.database.db, {
    attachmentsDir: path.join(fixture.root, '.git', 'attachments'),
  })
  await engine.ready
  const git = new GitWorktreeService(
    new GitService(createWorkspacePaths(fixture.root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
    }),
  )
  return { engine, git }
}
