import { AgentReviewService } from './review/agent-review'
import { agentReviewRoutes } from './review/routes'
import { sessionControlRoutes } from './provider/session-control-routes'
import { createAttachmentOwnership } from './attachments/ownership'
import { selectTitleModel } from './orchestration/title-generation'
import { errorMessage } from '@workspace/contracts'
import { BundleLibrary } from './themes/bundle-library'
import { platformHomePath } from './home'
import { bundleRoutes } from './themes/bundle-routes'
import { WallpaperLibrary } from './themes/wallpapers/library'
import { wallpaperLibraryRoutes } from './themes/wallpapers/routes'
import { createInternalError } from './observability/structured-errors'
import { cors } from '@elysiajs/cors'
import {
  terminalClearInputSchema,
  terminalRestartInputSchema,
  terminalKillInputSchema,
  type HealthDescriptor,
} from '@workspace/contracts'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { Elysia } from 'elysia'
import { attachmentRoutes } from './attachments/routes'
import { authGuard, createAuthConfig, isCorsOriginAllowed, type AuthOptions } from './auth'
import { getDefaultPlatformDatabase } from './db/client'
import { initializePlatformDatabase } from './db/initialize'
import { readEnvironmentIdentity } from './db/environment-identity'
import { fontRoutes } from './fonts/routes'
import { FontCatalogService } from './fonts/catalog'
import { errorPayload, FsError, isFsError } from './fs/errors'
import { fsRoutes } from './fs/routes'
import { FileSystemService, type FileSystemServiceOptions } from './fs/service'
import { treeWatchSource } from './fs/tree-watch'
import { gitRoutes } from './git/routes'
import { GitService } from './git/service'
import { CommitMessageGenerator } from './git/commit-message-generator'
import { setLspDownloadPolicy } from './lsp/installers'
import { LspSessionPool } from './lsp/proxy-session'
import { lspMatchQuerySchema, lspRouteMatch, lspRouteSemanticTokens, lspRoutes } from './lsp/routes'
import {
  applyObservability,
  flushObservability,
  isEvlogError,
  observabilityRoutes,
  recordClientInstance,
  recordProcessInfo,
  recordProcessWarning,
  recordRequestContext,
  recordRequestError,
  runDetached,
  setLogRetentionDays,
} from './observability'
import { OrchestrationEngine } from './orchestration/engine'
import { requireWorktree } from './orchestration/read-model'
import { OrchestrationCheckpointHunks } from './orchestration/checkpoint-hunks'
import { OrchestrationCheckpointDiffQuery } from './orchestration/checkpoint-diff-query'
import type { OrchestrationDatabase } from './orchestration/event-store'
import { orchestrationRoutes } from './orchestration/routes'
import { OrchestrationSessionSearchQuery } from './orchestration/session-search-query'
import {
  createOrchestrationSockets,
  orchestrationWsRoutes,
  orchestrationWsServerConfig,
  type OrchestrationSockets,
} from './orchestration/ws-rpc'
import {
  createDefaultProviderAdapterRegistry,
  type ProviderAdapterRegistry,
} from './provider/provider-adapter-registry'
import { providerRoutes } from './provider/routes'
import { settingsRoutes } from './settings/routes'
import { PaletteLibrary } from './themes/palette-library'
import { themeRoutes } from './themes/routes'
import { DEFAULT_PROVIDER_INSTANCES } from './provider/drivers/built-in'
import { mergeProviderInstanceConfigs } from './provider/utils/instance-config-merge'
import { SettingsStore, type SettingsStoreOptions } from './settings/store'
import { worktreeSubmoduleMode } from './git/submodules'
import { autoPullEnabled } from './git/auto-pull'
import { autoSettleRules } from './orchestration/utils/auto-settle-settings'
import { readBranchPullRequests, type ForgeBoundaries } from './git/pull-request'
import type { BranchPullRequestLookup } from './orchestration/pull-request-sync-reactor'
import { TerminalService, type TerminalPtyFactory } from './terminal/service'
import type { TerminalHostClient } from './terminal/host-client'
import type { ShellCommandReader } from './terminal/foreground'
import { wallpaperRoutes } from './wallpaper/routes'
import { webRoutes, type WebOptions } from './web/routes'
import { readReleaseInfoSync } from './web/release'
import { serverUpdateRoutes } from './update/routes'
import { ServerUpdate, type UpdateOptions } from './update/service'
import { ProviderSessionDirectory } from './provider/provider-session-directory'
import { ProviderService } from './provider/provider-service'
import { ProviderUsageHistoryReader } from './provider/usage-history'
import { ProviderPriceCatalog } from './provider/price-catalog'
import { ProviderMaintenance } from './provider/provider-maintenance'
import { ProviderUsageRecorder } from './provider/usage-recorder'
import { ProviderUsageStore } from './provider/usage-store'
import { ProviderResetCredits } from './provider/reset-credits'
import { MachineService, type MachineServiceOptions } from './machines/service'
import { machineRoutes } from './machines/routes'
import type { TailnetStatusCommand } from './machines/tailnet-hosts'
import { createMachineProxyRoutes } from './machines/proxy'
import type { PushFetcher } from './push/delivery'
import { pushRoutes } from './push/routes'
import { PushService } from './push/service'
import { sessionLink } from './push/session-link'
import { SessionNoticePush } from './push/session-notices'
import { ClientPresence } from './orchestration/client-presence'

import type { LogReaderService } from './observability/log-reader'

export type AppOptions = FileSystemServiceOptions & {
  machines?: MachineServiceOptions & { tailnetStatusCommand?: TailnetStatusCommand }
  logs?: LogReaderService
  auth?: AuthOptions
  terminal?: {
    env?: NodeJS.ProcessEnv
    ptyFactory?: TerminalPtyFactory
    hostClient?: TerminalHostClient
    /** Test seam: whether a shell runs a command, which fake PTYs cannot answer. */
    shellCommand?: ShellCommandReader
  }
  fonts?: FontCatalogService
  themes?: {
    /** Holds `wallpapers/`, `palettes/` and `themes/`. Defaults to the state home. */
    root?: string
    /** Populate the wallpaper picker from packaged artwork during startup. */
    seedWallpapers?: boolean
  }
  orchestration?: {
    attachmentsDir?: string
    database?: OrchestrationDatabase
    providerAdapterRegistry?: ProviderAdapterRegistry
    providerRuntime?: boolean
    /** Null turns pull request sync off; tests never reach a forge. */
    pullRequestLookup?: BranchPullRequestLookup | null
    /** Test seam: the forge CLIs and APIs the git service calls. */
    forgeBoundaries?: ForgeBoundaries
  }
  lsp?: {
    /**
     * Test seam: inject a pool so a test can put a fake backend in it and
     * assert `closeApp` killed it. Production always builds its own.
     */
    pool?: LspSessionPool
  }
  /**
   * Required in practice. `settingsPaths` throws `settings.FILE_PATH_UNSET`
   * without a user file path rather than defaulting to the home directory —
   * there are fifteen `createApp` call sites, and a forgotten one silently
   * reading and overwriting the developer's real settings is not recoverable,
   * because this repo deliberately keeps no healing code.
   */
  settings?: Omit<SettingsStoreOptions, 'workspaceRoot'>
  /** The origin forwarded to remote machines as this app's web origin. */
  webOrigin?: string
  web?: WebOptions
  /** Staged releases and Restart. Absent leaves both inert, as in dev and tests. */
  update?: UpdateOptions
  push?: { fetcher?: PushFetcher }
}

const appOrchestration = new WeakMap<object, OrchestrationEngine>()
const appMachines = new WeakMap<object, MachineService>()

export function machinesForApp(app: object) {
  const machines = appMachines.get(app)
  if (!machines) throw createInternalError('App has no machine service')
  return machines
}

export function orchestrationForApp(app: object) {
  const engine = appOrchestration.get(app)
  if (!engine) throw createInternalError('App has no orchestration engine')
  return engine
}

const appUpdates = new WeakMap<object, ServerUpdate>()

export function updateForApp(app: object) {
  const update = appUpdates.get(app)
  if (!update) throw createInternalError('App has no server update')
  return update
}

const appCleanups = new WeakMap<object, () => Promise<void>>()

const MIB = 1024 * 1024

/**
 * Every file the server opens has to save. A save is JSON, where a character can take six bytes
 * (a `\u` escape); Bun's own default is 128 MiB, which failed every save of a 129–200 MiB file.
 */
export function requestBodyLimit(maxTextFileBytes: number) {
  return maxTextFileBytes * 6 + MIB
}

export function createApp(options: AppOptions) {
  const fs = new FileSystemService(options)
  const git = new GitService(fs.paths, {
    autoPullPolicy: (root) =>
      autoPullEnabled(settings, () => orchestration.checkoutProjectId(root)),
    maxTextFileBytes: fs.info().maxTextFileBytes,
    forgeBoundaries: options.orchestration?.forgeBoundaries,
  })
  const database = options.orchestration?.database ?? getDefaultPlatformDatabase()
  // The schema has to exist before anything below reads this handle: the
  // identity row, the settings store, and the engine all query it while
  // `createApp` is still running. A database already at the schema version is left as is.
  initializePlatformDatabase(database)
  const terminal: TerminalService = new TerminalService({
    database,
    ...options.terminal,
    paths: fs.paths,
    resolveWorktree: async (worktreeId) => {
      const worktree = requireWorktree(await orchestration.readModelSnapshot(), worktreeId)
      if (worktree.lifecycle.state !== 'ready')
        throw createInternalError('Terminal requires a ready worktree')
      return worktree.canonicalPath
    },
    lifecycle: { begin: (worktreeId, key) => orchestration.beginTerminalLease(worktreeId, key) },
    resolveAgentSession: (input) => orchestration.beginAgentTerminal(input),
    resolveAdoptedLease: (key) => orchestration.adoptedLeaseForKey(key),
  })
  const fonts = options.fonts ?? new FontCatalogService()

  // Before the registry, because the registry is built *from* it. One SQLite
  // file backs the whole platform, so settings ride on whichever handle this
  // app was given — in tests that is the in-memory database, which is what
  // keeps a test run from writing into the developer's real settings.
  const settings = new SettingsStore({ ...options.settings, workspaceRoot: fs.paths.workspaceRoot })
  fs.watchDirectoryLimit = () => settings.snapshot().values['files.watchDirectoryLimit']
  fs.searchIndexSettings = () => {
    const values = settings.snapshot().values
    return {
      idleMinutes: values['files.searchIndexIdleMinutes'],
      limit: values['files.searchIndexLimit'],
    }
  }
  setLogRetentionDays(() => settings.snapshot().values['logs.retentionDays'])
  let watchDirectoryLimit = settings.snapshot().values['files.watchDirectoryLimit']
  settings.onChange(() => {
    const next = settings.snapshot().values['files.watchDirectoryLimit']
    if (next === watchDirectoryLimit) return
    watchDirectoryLimit = next
    fs.rebalanceWatchLimit()
  })
  const themesRoot = options.themes?.root ?? platformHomePath()
  const wallpapers = new WallpaperLibrary({
    directory: path.join(themesRoot, 'wallpapers'),
    settings,
  })
  const palettes = new PaletteLibrary({
    directory: path.join(themesRoot, 'palettes'),
    settings,
  })
  const bundles = new BundleLibrary({
    directory: path.join(themesRoot, 'themes'),
    palettes,
    wallpapers,
    settings,
  })
  palettes.assertUnused = (id) => bundles.assertPartUnused('palette', id)
  wallpapers.assertUnused = (id) => bundles.assertPartUnused('wallpaper', id)
  palettes.archiveDirectories = () => bundles.directories()
  wallpapers.archiveDirectories = () => bundles.directories()
  if (options.themes?.seedWallpapers) {
    runDetached(
      async () => {
        const started = performance.now()
        const result = await wallpapers.seed()
        recordProcessInfo('wallpapers.seed', {
          durationMs: Math.round(performance.now() - started),
          ...result,
        })
      },
      { area: 'wallpaper', operation: 'library.seed' },
    )
  }
  const providerAdapterRegistry: ProviderAdapterRegistry =
    options.orchestration?.providerAdapterRegistry ??
    createDefaultProviderAdapterRegistry(
      mergeProviderInstanceConfigs(
        DEFAULT_PROVIDER_INSTANCES,
        // Secrets put back before the first spawn, not after the first settings
        // write: `snapshot()` masks the provider environment, and handing the
        // mask to the registry launches every provider with `••••••••` as its
        // credential until something happens to touch settings.
        settings.providerInstancesForSpawnSync(),
      ),
      {
        // Disabling a provider must not kill a turn that is mid-stream. The
        // registry defers disposal while the directory still lists a session on
        // that instance, and removes it on the next reconcile once the turn ends.
        //
        // Filtered on status: rows outlive their turns — nothing deletes them —
        // so an unfiltered scan reports every instance ever used as live, and
        // the deferral would never resolve.
        hasLiveSessions: (providerInstanceId) =>
          providerService.hasActiveRuntimeForInstance(providerInstanceId),
      },
    )
  // A saved provider list is inert unless something re-runs the registry when
  // it changes. Without this the settings UI writes rows the server never reads
  // until the next restart.
  //
  // Secrets are resolved here rather than in the snapshot: the values a provider
  // spawns with never appear in anything a route can return.
  const reconcileProviderSettings = providerSettingsReconciler(settings, providerAdapterRegistry)
  settings.onChange(() => {
    runDetached(reconcileProviderSettings, { area: 'provider', operation: 'reconcile' })
  })
  const providerService = new ProviderService({
    adapterRegistry: providerAdapterRegistry,
    sessionDirectory: new ProviderSessionDirectory(database),
  })
  const providerUsage = new ProviderUsageStore(providerAdapterRegistry)
  const providerResetCredits = new ProviderResetCredits(
    database,
    providerAdapterRegistry,
    providerUsage,
  )
  const providerPrices = new ProviderPriceCatalog(database)
  const providerUsageRecorder = new ProviderUsageRecorder(
    database,
    providerAdapterRegistry,
    providerPrices,
  )
  const providerUsageHistory = new ProviderUsageHistoryReader(database)
  const providerMaintenance = new ProviderMaintenance(providerAdapterRegistry)
  providerService.subscribeRuntimeEvents((event) => providerUsage.accept(event))
  providerService.subscribeUsage((event, purpose) => providerUsageRecorder.accept(event, purpose))
  providerService.subscribeImportedUsage((input, usage) =>
    providerUsageRecorder.importTurns(input, usage),
  )
  const orchestration = new OrchestrationEngine(database, {
    responseStreamingMode: (projectId) => {
      const values = settings.snapshot().values
      return (
        values['chat.projectResponseStreamingModes'][projectId] ??
        values['chat.responseStreamingMode']
      )
    },
    titleModel: async (projectId) => {
      const values = settings.snapshot().values
      const configured =
        values['chat.projectTextGenerationModels'][projectId] ?? values['chat.textGenerationModel']
      const { providers } = await providerAdapterRegistry.listProviders()
      return selectTitleModel(configured, providers)
    },
    keepImportedSessionsUpdated: () =>
      settings.snapshot().values['chat.keepImportedSessionsUpdated'],
    worktreeSubmodules: (projectId) => worktreeSubmoduleMode(settings, projectId),
    autoSettleRules: (projectId) => autoSettleRules(settings, projectId),
    worktreeCleanupOnDelete: (projectId) => {
      const values = settings.snapshot().values
      return (
        values['git.projectWorktreeCleanupOnDelete'][projectId] ??
        values['git.worktreeCleanupOnDelete']
      )
    },
    pullRequestLookup:
      options.orchestration?.pullRequestLookup === undefined
        ? (input) => readBranchPullRequests(input)
        : (options.orchestration.pullRequestLookup ?? undefined),
    providerService,
    terminalService: terminal,
    attachmentsDir: options.orchestration?.attachmentsDir,
    registration: { git, paths: fs.paths },
    providerRuntime: options.orchestration?.providerRuntime
      ? { checkpointGit: git, providerService }
      : false,
  })
  settings.onChange(() => {
    runDetached(() => orchestration.settleSessions(), { area: 'chat', operation: 'auto_settle' })
    runDetached(() => orchestration.cleanupWorktrees(), {
      area: 'worktree',
      operation: 'auto_cleanup',
    })
  })
  const identity = readEnvironmentIdentity(database)
  const serverConfig = orchestrationWsServerConfig(identity)
  const commitMessages = new CommitMessageGenerator(git, providerAdapterRegistry, providerService)
  const checkpointDiff = new OrchestrationCheckpointDiffQuery(database, git)
  const agentReviews = new AgentReviewService({ checkpointDiff, git, providers: providerService })
  const checkpointHunks = new OrchestrationCheckpointHunks({
    runWorkspaceOperation: (sessionId, operation) =>
      orchestration.runWorkspaceOperation(sessionId, operation),
    activeRuntimes: () => providerService.listActiveRuntimes(),
    diffs: checkpointDiff,
    git,
    readModel: () => orchestration.readModelSnapshot(),
  })
  const sessionSearch = new OrchestrationSessionSearchQuery(database)
  const auth = createAuthConfig(options.auth)
  const push = new PushService({ database, settings, fetcher: options.push?.fetcher })
  const presence = new ClientPresence()
  const sessionPush = new SessionNoticePush({
    environmentId: identity.id,
    engine: orchestration,
    settings,
    presence,
    push,
    link: ({ notice, worktreeId }) =>
      sessionLink(orchestration, fs, notice.ref.sessionId, worktreeId),
  })
  const machines = new MachineService({
    ...options.machines,
    environmentId: identity.id,
    webOrigin: options.webOrigin ?? auth.allowedOrigins[0] ?? 'http://localhost:3000',
    readMachines: () => settings.snapshot().values['environments.machines'],
  })
  settings.onChange(() => {
    runDetached(() => machines.reconcile(), { area: 'machines', operation: 'reconcile' })
  })
  // Read through the store on every call rather than captured once: a language
  // server that only picked up a settings change on restart would be a knob the
  // page claims is live and is not.
  const lspSettings = () => {
    // One snapshot per call: `snapshot()` re-resolves every layer, so reading
    // two keys through two calls would resolve the whole document twice per
    // `/lsp/match` request.
    const { values } = settings.snapshot()

    return {
      servers: values['lsp.servers'],
      languageServers: values['lsp.languageServers'],
      tyForPython: values['lsp.experimental.tyForPython'],
    }
  }
  // The one knob that cannot be passed as a parameter — see the comment on
  // `setLspDownloadPolicy`.
  setLspDownloadPolicy(() => settings.snapshot().values['lsp.downloadRuntimes'])
  const lspPool =
    options.lsp?.pool ??
    new LspSessionPool(
      () => settings.snapshot().values['lsp.idleTimeoutMs'],
      () => settings.snapshot().values['lsp.semanticTokens.delta'],
      treeWatchSource(fs.changes, fs.paths),
    )
  const orchestrationSockets = createOrchestrationSockets()
  const cleanup = appCleanup(
    orchestrationSockets,
    terminal,
    fs,
    settings,
    lspPool,
    providerService,
    orchestration,
    machines,
    providerPrices,
    providerMaintenance,
    providerResetCredits,
    sessionPush,
  )
  const update = new ServerUpdate({
    root: options.update?.root ?? null,
    restart: options.update?.restart ?? noop,
    serverRelease: readReleaseInfoSync(options.web?.serverReleaseFile).release,
    gate: orchestration,
  })

  const app = new Elysia({
    name: 'platform',
    serve: { maxRequestBodySize: requestBodyLimit(fs.info().maxTextFileBytes) },
  })
  applyObservability(app)

  const configured = app
    .use(
      cors({
        allowedHeaders: ['authorization', 'content-type', 'x-client-instance', 'x-evlog-source'],
        exposeHeaders: [
          'cache-control',
          'content-length',
          'content-type',
          'x-fs-mtime-ms',
          'x-fs-path',
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        origin: (request) => isCorsOriginAllowed(auth, request.headers.get('origin')),
      }),
    )
    .onError(({ code, error, set }) => appErrorPayload(code, error, set))
    // Public: the page, its files and the release descriptor load before any
    // origin is known. Mounted before every parent hook: an Elysia plugin
    // mounted after one parent `onBeforeHandle` inherits the parent's later
    // hooks too, which would put the auth guard in front of index.html.
    .use(webRoutes(options.web ?? {}, update, terminal))
    .onBeforeHandle(({ request }) => {
      recordClientInstance(request)
    })
    // Auth runs after the WS upgrade so the browser receives the explicit 1008 refusal.
    .use(
      orchestrationWsRoutes(orchestration, auth, identity, orchestrationSockets, update, presence),
    )
    .onBeforeHandle(authGuard(auth))
    .use(serverUpdateRoutes(update))
    .use(
      machineRoutes(
        machines,
        {
          homeDirectory: options.homeDirectory ?? homedir(),
          systemDirectory: path.join(options.systemRoot ?? '/', 'etc/ssh'),
        },
        options.machines?.tailnetStatusCommand,
      ),
    )
    .use(createMachineProxyRoutes({ auth, resolve: (name) => machines.resolve(name) }))
    .use(observabilityRoutes({ logs: options.logs }))
    .get(
      '/health',
      () =>
        ({
          ok: true,
          environmentId: identity.id,
          label: hostname(),
          protocolVersion: serverConfig.protocolVersion,
          serverVersion: serverConfig.serverVersion,
          release: options.web?.serverReleaseFile
            ? path.basename(path.dirname(options.web.serverReleaseFile))
            : null,
          capabilities: {
            sessionSettlement: true,
            sessionSnooze: true,
            sessionPinning: true,
            sessionPinReorder: true,
            sessionActiveReorder: true,
            sessionTitleRegeneration: true,
          },
          platform: { os: process.platform, arch: process.arch },
          ...fs.info(),
        }) satisfies HealthDescriptor,
    )
    .get('/lsp/match', ({ query }) => lspRouteMatch(fs.paths, query, lspSettings()), {
      query: lspMatchQuerySchema,
    })
    .get(
      '/lsp/semantic-tokens',
      ({ query }) => lspRouteSemanticTokens(fs.paths, query, lspSettings(), lspPool),
      { query: lspMatchQuerySchema },
    )
    .ws('/lsp', lspRoutes(fs, auth, { pool: lspPool, settings: lspSettings }))
    .ws('/terminal', terminal.routes(auth))
    .post('/terminal/restart', ({ body }) => terminal.restart(body), {
      body: terminalRestartInputSchema,
    })
    .post('/terminal/clear', ({ body }) => terminal.clear(body), { body: terminalClearInputSchema })
    .post('/terminal/kill', ({ body }) => terminal.kill(body), { body: terminalKillInputSchema })
    .use(
      providerRoutes(
        providerAdapterRegistry,
        providerUsage,
        providerUsageHistory,
        providerMaintenance,
        providerResetCredits,
      ),
    )
    .use(sessionControlRoutes(providerService))
    .use(agentReviewRoutes(agentReviews))
    .use(orchestrationRoutes(orchestration, checkpointDiff, sessionSearch, checkpointHunks))
    .use(
      attachmentRoutes({
        attachmentsDir: options.orchestration?.attachmentsDir,
        ownership: createAttachmentOwnership(database),
      }),
    )
    .use(fontRoutes(fonts))
    .use(wallpaperRoutes())
    .use(settingsRoutes(settings))
    .use(pushRoutes(push))
    .use(themeRoutes(palettes))
    .use(bundleRoutes(bundles))
    .use(wallpaperLibraryRoutes(wallpapers))
    .use(
      gitRoutes(git, commitMessages, {
        resolveBaseCommit: (checkoutPath) => orchestration.worktreeBaseCommit(checkoutPath),
        worktreeBaseBranches: () => orchestration.worktreeBaseBranches(),
        refreshMetadata: (checkoutPath) => orchestration.refreshWorktreeMetadata(checkoutPath),
        registerClone: (absolutePath) => orchestration.registerCheckout(absolutePath),
        submoduleMode: async (checkoutPath) =>
          worktreeSubmoduleMode(settings, await orchestration.worktreeProjectId(checkoutPath)),
      }),
    )
    .use(fsRoutes(fs))
    .onStart(() => {
      void providerPrices.refresh()
    })
    .onStop(cleanup)
  // Recovery starts for in-process apps too; terminal opens wait until lease adoption finishes.
  void terminal
    .reattach()
    .catch((error: unknown) =>
      recordProcessWarning('terminal.host.recovery_failed', { area: 'terminal', error }),
    )
  appCleanups.set(configured, cleanup)
  appOrchestration.set(configured, orchestration)
  appUpdates.set(configured, update)
  appMachines.set(configured, machines)
  return configured
}

export type App = ReturnType<typeof createApp>

export async function closeApp(app: App) {
  await appCleanups.get(app)?.()
}

function providerSettingsReconciler(
  settings: SettingsStore,
  providerAdapterRegistry: ProviderAdapterRegistry,
) {
  let current = settings.providerInstancesForSpawnSync()

  return async () => {
    const next = await settings.providerInstancesForSpawn()
    if (providerInstancesEqual(current, next)) return

    current = next
    await providerAdapterRegistry.reconcile(
      mergeProviderInstanceConfigs(DEFAULT_PROVIDER_INSTANCES, next),
    )
  }
}

function providerInstancesEqual(
  left: ReturnType<SettingsStore['providerInstancesForSpawnSync']>,
  right: ReturnType<SettingsStore['providerInstancesForSpawnSync']>,
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function appCleanup(
  orchestrationSockets: OrchestrationSockets,
  terminal: TerminalService,
  fs: FileSystemService,
  settings: SettingsStore,
  lspPool: LspSessionPool,
  providerService: ProviderService,
  orchestration: OrchestrationEngine,
  machines: MachineService,
  providerPrices: ProviderPriceCatalog,
  providerMaintenance: ProviderMaintenance,
  providerResetCredits: ProviderResetCredits,
  sessionPush: SessionNoticePush,
) {
  let closed = false

  return async () => {
    if (closed) return

    closed = true
    // A signal stop admits no provider start while the runtime shuts down.
    orchestration.holdProviderStarts()
    orchestrationSockets.closeAll()
    sessionPush.close()
    // Kills the language servers, before any await: the service manager signals them with the
    // server, and an exit that lands before this is logged as a crash.
    lspPool.disposeAll()
    await machines.close()
    await terminal.dispose()
    // Releases the settings file watchers; without this a test run leaks a
    // native handle per app it builds.
    settings.close()
    await orchestration.close()
    await providerService.shutdown()
    providerPrices.close()
    providerMaintenance.close()
    providerResetCredits.close()
    await fs.close()
    await flushObservability()
  }
}

function appErrorPayload(
  code: unknown,
  error: unknown,
  set: {
    status?: number | string
  },
) {
  const responseError = errorForResponse(code, error)
  set.status = responseError.statusCode
  recordRequestContext({
    errorCode: responseError.code,
    status: responseError.statusCode,
  })
  recordRequestError(responseError, {
    area: 'server',
    operation: 'request_error',
    status: responseError.statusCode,
  })

  return responseErrorPayload(responseError)
}

function errorForResponse(code: unknown, error: unknown) {
  if (isFsError(error)) return error
  if (isEvlogError(error)) return error
  if (code === 'NOT_FOUND') return new FsError('ROUTE_NOT_FOUND')
  if (code === 'VALIDATION') return new FsError('INVALID_PATH', errorMessage(error))

  return new FsError('OPERATION_FAILED', undefined, error)
}

/**
 * `why` and `fix` are static catalog prose — no request data, nothing to
 * redact. Dropping them here is why a toast could say what failed but never
 * what to do about it, while the server log held the answer all along.
 */
function responseErrorPayload(error: { code?: string; message: string; statusCode: number }) {
  if (isFsError(error)) return errorPayload(error)

  const guidance = isEvlogError(error) ? { fix: error.fix, link: error.link, why: error.why } : {}

  return {
    error: {
      code: error.code ?? 'OPERATION_FAILED',
      message: error.message,
      ...definedOnly(guidance),
    },
  }
}

function definedOnly(values: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

function noop() {}
