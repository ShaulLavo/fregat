import type { EnvironmentId } from '@workspace/contracts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  cleanupObservation,
  fixtureDirectoryAvailability,
  observeFixtureRemoval,
} from './env/cleanup-observation'
import {
  closeApp,
  createApp,
  appUsageCollector,
  createMetadataDatabase,
  FontCatalogService,
  initializePlatformDatabase,
  MockProviderAdapter,
  ProviderAdapterRegistry,
  releaseSource,
  resolveLspServer,
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
  /** Effective server state home, isolated from the workspace by default. */
  readonly stateHome: string
  workspaceEditJournalRoot: string
  origin: string
  restart: (
    options?: Pick<AppOptions, 'system' | 'systemRoot' | 'workspaceRoot'> & {
      providerRuntime?: boolean
      settingsWatch?: boolean
      providerAdapter?: MockProviderAdapter
      additionalProviderAdapters?: readonly MockProviderAdapter[]
    },
  ) => Promise<void>
  cleanup: () => Promise<void>
}

// Real app routes, contracts, and filesystem against a throwaway workspace.
// External providers and language-server processes use test boundaries.
type TestServerOptions = Pick<
  AppOptions,
  | 'workspaceEditClock'
  | 'workspaceEditDriver'
  | 'machines'
  | 'update'
  | 'web'
  | 'system'
  | 'systemRoot'
  | 'workspaceRoot'
> & {
  persistentDatabase?: boolean
  providerRuntime?: boolean
  environmentId?: EnvironmentId
  filesystemWatch?: boolean
  providerAdapter?: MockProviderAdapter
  forgeBoundaries?: NonNullable<AppOptions['orchestration']>['forgeBoundaries']
  settingsWatch?: boolean
}

export async function makeTestServer({
  environmentId,
  persistentDatabase = false,
  providerRuntime = false,
  filesystemWatch = true,
  providerAdapter = new MockProviderAdapter(),
  settingsWatch = false,
  forgeBoundaries,
  workspaceEditClock,
  workspaceEditDriver,
  machines,
  update,
  web,
  system,
  systemRoot,
  workspaceRoot,
}: TestServerOptions = {}): Promise<TestServer> {
  const root = await mkdtemp(path.join(tmpdir(), 'web-itest-'))
  const stateHome = await mkdtemp(path.join(tmpdir(), 'web-istate-'))
  const workspaceEditJournalRoot = path.join(root, '.platform-test', 'workspace-edit-journals')
  const database = createMetadataDatabase({
    databasePath: persistentDatabase
      ? path.join(root, '.platform-test', 'metadata.sqlite')
      : ':memory:',
  })
  initializePlatformDatabase(database.db)
  if (environmentId)
    database.db.$client.run('UPDATE environment_identity SET id = ?', [environmentId])
  let additionalProviderAdapters: readonly MockProviderAdapter[] = []
  const buildApp = () =>
    createApp({
      auth: { allowedOrigins: [TEST_ORIGIN] },
      homeDirectory: root,
      systemRoot: systemRoot ?? root,
      system: { ...system, stateHome: system?.stateHome ?? stateHome },
      // Keep the real parser/cache/route path, but pin its cache inside this
      // fixture. MSW supplies the external downloads page.
      fonts: new FontCatalogService({
        cacheRoot: path.join(root, '.platform-test', 'fonts'),
        // The machine's installed fonts would make every catalog answer differ per checkout.
        listInstalled: async () => '',
      }),
      metadataDatabase: database,
      lsp: {
        resolveServer: async (input) => {
          const match = await resolveLspServer(input)
          if (!match) return null

          // UI tests keep real matching and pooling without installing or starting a binary.
          return { ...match, server: { ...match.server, spawn: async () => null } }
        },
      },
      orchestration: {
        attachmentsDir: path.join(root, '.platform-test', 'attachments'),
        database: database.db,
        providerRuntime,
        // The default lookup runs the real forge CLI; tests record pull requests themselves.
        pullRequestLookup: null,
        forgeBoundaries,
        // Never the default registry: its Codex and Claude adapters shell out to
        // real CLIs, so any route that touches a provider would spawn a binary,
        // read the developer's own machine, and answer differently per checkout.
        providerAdapterRegistry: new ProviderAdapterRegistry({
          adapters: [providerAdapter, ...additionalProviderAdapters],
          services: { cwd: process.cwd() },
        }),
      },
      // The defaults reach registry.npmjs.org and models.dev for real CLI versions
      // and prices; every origin here is the in-process happy-dom window, whose
      // fetch adds a CORS preflight against its own page origin for either call.
      provider: {
        maintenanceProbe: { fetcher: async () => Response.json({ version: '0.0.0' }) },
        priceCatalogFetcher: async () =>
          Response.json({
            anthropic: { models: { claude: { cost: { input: 0, output: 0 } } } },
          }),
      },
      settings: testSettingsOptions(root, { watch: settingsWatch }),
      themes: { root: path.join(root, '.platform') },
      watch: filesystemWatch,
      workspaceEditClock,
      workspaceEditDriver,
      workspaceEditJournalRoot,
      workspaceRoot: workspaceRoot ?? root,
      machines: {
        tailnetStatusCommand: async () => '{"BackendState":"Stopped"}',
        // Tests run the server from source; they stand for a production primary with no release.
        releaseSource: releaseSource('/platform-test/no-release/server'),
        ...machines,
      },
      update,
      web,
    })

  let app = buildApp()
  // app.handle has no listen lifecycle; start the real collector against injected adapters.
  appUsageCollector(app).start()
  await appUsageCollector(app).refresh()
  return {
    get app() {
      return app
    },
    restart: async (options = {}) => {
      await closeApp(app)
      providerRuntime = options.providerRuntime ?? providerRuntime
      settingsWatch = options.settingsWatch ?? settingsWatch
      providerAdapter = options.providerAdapter ?? providerAdapter
      additionalProviderAdapters = options.additionalProviderAdapters ?? []
      system = options.system ?? system
      systemRoot = options.systemRoot ?? systemRoot
      workspaceRoot = options.workspaceRoot ?? workspaceRoot
      app = buildApp()
      appUsageCollector(app).start()
      await appUsageCollector(app).refresh()
    },
    cleanup: () => cleanupTestServer(app, root, stateHome, database),
    database,
    origin: TEST_ORIGIN,
    get providerAdapter() {
      return providerAdapter
    },
    root,
    get stateHome() {
      return system?.stateHome ?? stateHome
    },
    workspaceEditJournalRoot,
  }
}

async function cleanupTestServer(
  app: ReturnType<typeof createApp>,
  root: string,
  stateHome: string,
  database: MetadataDatabaseHandle,
) {
  const observation = cleanupObservation(app)
  try {
    observation.point('app', 'before', 'available')
    await closeApp(app)
    observation.point('app', 'after')
  } finally {
    observation.point('database', 'before', 'available')
    database.close()
    observation.point('database', 'after')
    observation.point('removals', 'before')
    observation.point('workspace', 'before', fixtureDirectoryAvailability(root))
    const removeRoot = observeFixtureRemoval(
      rm(root, { force: true, recursive: true }),
      observation,
      'workspace',
      root,
    )
    observation.point('state-home', 'before', fixtureDirectoryAvailability(stateHome))
    const removeStateHome = observeFixtureRemoval(
      rm(stateHome, { force: true, recursive: true }),
      observation,
      'state-home',
      stateHome,
    )
    await Promise.all([removeRoot, removeStateHome])
    observation.point('removals', 'after')
  }
}
