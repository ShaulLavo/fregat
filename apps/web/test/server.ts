import type { EnvironmentId } from '@workspace/contracts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  closeApp,
  createApp,
  createMetadataDatabase,
  migratePlatformDatabase,
  MockProviderAdapter,
  NerdFontService,
  ProviderAdapterRegistry,
  testSettingsOptions,
  type AppOptions,
  type MetadataDatabaseHandle,
} from 'server/testing'

// Origin the in-process client presents; the app's auth guard requires a
// trusted origin, so the test client and the app must agree on this value.
export const TEST_ORIGIN = 'http://localhost:5173'

export type TestServer = {
  /** The real Elysia app — drive it with `app.handle(new Request(...))`. */
  app: ReturnType<typeof createApp>
  database: MetadataDatabaseHandle
  /** Provider boundary used by orchestration routes, exposed for behavioural assertions. */
  providerAdapter: MockProviderAdapter
  /** Isolated temp workspace root backing this app's filesystem. */
  root: string
  workspaceEditJournalRoot: string
  origin: string
  restart: (options?: {
    providerRuntime?: boolean
    providerAdapter?: MockProviderAdapter
  }) => Promise<void>
  cleanup: () => Promise<void>
}

// Boots a real server against a throwaway workspace. No network, no mocks: the
// app routes, valibot contracts, and filesystem are the genuine article.
type TestServerOptions = Pick<
  AppOptions,
  'workspaceEditClock' | 'workspaceEditDriver' | 'machines'
> & {
  persistentDatabase?: boolean
  providerRuntime?: boolean
  environmentId?: EnvironmentId
  filesystemWatch?: boolean
  providerAdapter?: MockProviderAdapter
  settingsWatch?: boolean
}

export async function makeTestServer({
  environmentId,
  persistentDatabase = false,
  providerRuntime = false,
  filesystemWatch = true,
  providerAdapter = new MockProviderAdapter(),
  settingsWatch = false,
  workspaceEditClock,
  workspaceEditDriver,
  machines,
}: TestServerOptions = {}): Promise<TestServer> {
  const root = await mkdtemp(path.join(tmpdir(), 'web-itest-'))
  const workspaceEditJournalRoot = path.join(root, '.platform-test', 'workspace-edit-journals')
  const database = createMetadataDatabase({
    databasePath: persistentDatabase
      ? path.join(root, '.platform-test', 'metadata.sqlite')
      : ':memory:',
  })
  migratePlatformDatabase(database.db)
  if (environmentId)
    database.db.$client.run('UPDATE environment_identity SET id = ?', [environmentId])
  const buildApp = () =>
    createApp({
      auth: { allowedOrigins: [TEST_ORIGIN] },
      homeDirectory: root,
      systemRoot: root,
      // Keep the real parser/cache/route path, but pin its cache inside this
      // fixture. MSW supplies the external downloads page.
      fonts: new NerdFontService({ cacheRoot: path.join(root, '.platform-test', 'fonts') }),
      metadataDatabase: database,
      orchestration: {
        attachmentsDir: path.join(root, '.platform-test', 'attachments'),
        database: database.db,
        providerRuntime,
        // Never the default registry: its Codex and Claude adapters shell out to
        // real CLIs, so any route that touches a provider would spawn a binary,
        // read the developer's own machine, and answer differently per checkout.
        providerAdapterRegistry: new ProviderAdapterRegistry([providerAdapter]),
      },
      settings: testSettingsOptions(root, { watch: settingsWatch }),
      themes: { root: path.join(root, '.platform') },
      watch: filesystemWatch,
      workspaceEditClock,
      workspaceEditDriver,
      workspaceEditJournalRoot,
      workspaceRoot: root,
      machines: { tailnetStatusCommand: async () => '{"BackendState":"Stopped"}', ...machines },
    })

  let app = buildApp()
  return {
    get app() {
      return app
    },
    restart: async (options = {}) => {
      await closeApp(app)
      providerRuntime = options.providerRuntime ?? providerRuntime
      providerAdapter = options.providerAdapter ?? providerAdapter
      app = buildApp()
    },
    cleanup: () => cleanupTestServer(app, root, database),
    database,
    origin: TEST_ORIGIN,
    get providerAdapter() {
      return providerAdapter
    },
    root,
    workspaceEditJournalRoot,
  }
}

async function cleanupTestServer(
  app: ReturnType<typeof createApp>,
  root: string,
  database: MetadataDatabaseHandle,
) {
  try {
    await closeApp(app)
  } finally {
    database.close()
    await rm(root, { force: true, recursive: true })
  }
}
