import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TUI_CLIENT_ORIGIN } from '@workspace/contracts'
import {
  closeApp,
  createApp,
  createMetadataDatabase,
  migratePlatformDatabase,
  MockProviderAdapter,
  LogReaderService,
  FontCatalogService,
  ProviderAdapterRegistry,
  createTestTerminalHost,
  testSettingsOptions,
  type MetadataDatabaseHandle,
  type AppOptions,
} from 'server/testing'

const TEST_SERVER_ORIGIN = 'http://platform-tui.test'
const TEST_CLIENT_ORIGIN = TUI_CLIENT_ORIGIN

export type TestServer = Awaited<ReturnType<typeof makeTestServer>>
type TestTerminalHost = Awaited<ReturnType<typeof createTestTerminalHost>>

type TestServerOptions = Pick<AppOptions, 'terminal' | 'lsp' | 'workspaceEditDriver'> & {
  providerAdapter?: MockProviderAdapter
  providerRuntime?: boolean
}

export async function makeTestServer(options: TestServerOptions = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-tui-test-'))
  try {
    return await buildTestServer(root, options)
  } catch (error) {
    await rm(root, { force: true, recursive: true })
    throw error
  }
}

async function buildTestServer(root: string, options: TestServerOptions) {
  // Without an injected terminal the server refuses to reach the developer's real terminal host.
  const host = options.terminal ? null : await createTestTerminalHost()
  const database = createMetadataDatabase({ databasePath: ':memory:' })
  try {
    return createServerWithDatabase(
      root,
      database,
      {
        ...options,
        terminal: options.terminal ?? { hostClient: host?.client },
      },
      host,
    )
  } catch (error) {
    database.close()
    await host?.close()
    throw error
  }
}

function createServerWithDatabase(
  root: string,
  database: MetadataDatabaseHandle,
  options: TestServerOptions,
  host: TestTerminalHost | null,
) {
  migratePlatformDatabase(database.db)
  const {
    providerAdapter = new MockProviderAdapter(),
    providerRuntime = false,
    ...appOptions
  } = options
  const workspaceEditJournalRoot = path.join(root, '.platform-test', 'workspace-edit-journals')
  const buildApp = () =>
    createApp({
      ...appOptions,
      logs: new LogReaderService({ dir: path.join(root, 'logs') }),
      auth: { allowedOrigins: [TEST_CLIENT_ORIGIN] },
      fonts: new FontCatalogService({
        cacheRoot: path.join(root, '.platform-test', 'fonts'),
        listInstalled: async () => '',
      }),
      metadataDatabase: database,
      machines: { tailnetStatusCommand: async () => '{"BackendState":"Stopped"}' },
      orchestration: {
        attachmentsDir: path.join(root, '.platform-test', 'attachments'),
        database: database.db,
        providerAdapterRegistry: new ProviderAdapterRegistry([providerAdapter]),
        providerRuntime,
        // The default lookup runs the real forge CLI; tests record pull requests themselves.
        pullRequestLookup: null,
      },
      settings: testSettingsOptions(root),
      watch: false,
      workspaceEditJournalRoot,
      workspaceRoot: root,
    })

  let app = buildApp()
  return {
    get app() {
      return app
    },
    database,
    providerAdapter,
    root,
    workspaceEditJournalRoot,
    origin: TEST_SERVER_ORIGIN,
    clientOrigin: TEST_CLIENT_ORIGIN,
    async restart() {
      await closeApp(app)
      app = buildApp()
    },
    async cleanup() {
      try {
        await closeApp(app)
      } finally {
        await host?.close()
        await closeDatabaseAndWorkspace(database, root)
      }
    },
  }
}

async function closeDatabaseAndWorkspace(database: MetadataDatabaseHandle, root: string) {
  try {
    database.close()
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}
