import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  providerInstanceIdSchema,
  sessionIdSchema,
  type SessionId,
  type ProviderInstanceId,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { ProviderDiscoveredSession, ProviderHistoryMessage } from '../../../provider/types'
import { createWorkspacePaths } from '../../../fs/path'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../../fs/limits'
import { GitService } from '../../../git/service'
import { OrchestrationEngine } from '../../engine'
import { createProjectionFixture } from './projection'
import { OrchestrationSessionSearchQuery } from '../../session-search-query'
import { SessionDiscoveryReconciler } from '../../session-discovery'

export function discoveryHistory(text = 'Existing conversation'): ProviderHistoryMessage[] {
  return [
    { sourceId: 'user-1', role: 'user', text, createdAt: '2026-09-04T00:00:00.000Z' },
    {
      sourceId: 'assistant-1',
      role: 'assistant',
      text: 'Existing answer',
      createdAt: '2026-09-04T00:00:01.000Z',
    },
  ]
}

export async function sessionImportFixture() {
  const fixture = await discoveryFixture()
  await fixture.register()
  const instance = v.parse(providerInstanceIdSchema, 'claude-history')
  const otherInstance = v.parse(providerInstanceIdSchema, 'codex-history')
  const sessionId = v.parse(sessionIdSchema, 'c92e79b6-c6cb-4b58-ae17-2a77a5bf721d')
  const row: ProviderDiscoveredSession & { providerInstanceId: ProviderInstanceId } = {
    providerInstanceId: instance,
    sessionId,
    cwd: fixture.main,
    title: 'Imported conversation',
    sourceUpdatedAt: '2026-09-05T00:00:00.000Z',
    gitBranch: null,
  }
  const scans: ProviderInstanceId[] = []
  const reads: SessionId[] = []
  const source = {
    rows: [row],
    messages: discoveryHistory(),
    scans,
    reads,
    keepUpdated: true,
    beforeRead: async () => {},
  }
  const reconciler = new SessionDiscoveryReconciler({
    ...fixture,
    keepUpdated: () => source.keepUpdated,
    dispatch: (command) => fixture.engine.dispatch(command),
    providerService: {
      ...fixture.providerHistory,
      discoveryInstances: () => [instance, otherInstance],
      discoverSessions: async ({ providerInstanceId, offset, limit }) => {
        source.scans.push(providerInstanceId)
        return source.rows
          .filter((entry) => entry.providerInstanceId === providerInstanceId)
          .slice(offset, offset + limit)
      },
      readSessionHistory: async ({ sessionId: id }) => {
        source.reads.push(id)
        await source.beforeRead()
        return source.messages
      },
    },
  })
  return {
    ...fixture,
    instance,
    otherInstance,
    sessionId,
    row,
    source,
    reconciler,
    close: async () => {
      await reconciler.close()
      await fixture.close()
    },
  }
}

export async function discoveryFixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'platform-discovery-')))
  const main = path.join(root, 'main')
  await mkdir(main)
  const persistence = createProjectionFixture()
  const paths = createWorkspacePaths(root)
  const git = new GitService(paths, { maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES })
  const registration = { git, paths }
  const engine = new OrchestrationEngine(persistence.database, {
    registration,
    providerRuntime: false,
  })
  await engine.ready
  return {
    root,
    main,
    registration,
    engine,
    search: new OrchestrationSessionSearchQuery(persistence.database),
    keepUpdated: () => true,
    canImportHistory: (sessionId: SessionId) => engine.canImportSessionHistory(sessionId),
    needsHistory: (sessionId: SessionId, sourceUpdatedAt: string) =>
      engine.needsSessionHistory(sessionId, sourceUpdatedAt),
    importHistory: (
      sessionId: SessionId,
      history: readonly ProviderHistoryMessage[],
      sourceUpdatedAt: string,
    ) => engine.importSessionHistory(sessionId, history, sourceUpdatedAt),
    providerHistory: {
      readSessionHistory: async () => discoveryHistory(),
      importSources: () => [],
    },
    getReadModel: () => persistence.snapshots.fullReadModel(),
    register: async (workspaceRoot = main, commandId = `registration:${workspaceRoot}`) =>
      engine.dispatchClientCommand({
        type: 'project.create',
        commandId,
        title: 'Discovery fixture',
        workspaceRoot,
      }),
    git: async (...args: string[]) => {
      const child = Bun.spawn(['git', ...args], { cwd: main, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      if (code !== 0) throw new TypeError(`Git fixture failed: ${stderr}`)
      return stdout.trim()
    },
    initializeGit: async () => {
      await writeFile(path.join(main, 'README.md'), '# Fixture\n')
      for (const args of [
        ['init', '-b', 'main'],
        ['add', '.'],
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-m',
          'initial',
        ],
      ]) {
        const child = Bun.spawn(['git', ...args], { cwd: main, stdout: 'ignore', stderr: 'pipe' })
        const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
        if (code !== 0) throw new TypeError(`Git fixture failed: ${stderr}`)
      }
    },
    close: async () => {
      await engine.close()
      persistence.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
