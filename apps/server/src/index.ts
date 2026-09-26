import { unique } from '@workspace/utils/collections'
import { errorMessage } from '@workspace/contracts'
import { homedir } from 'node:os'
import path from 'node:path'
import { closeApp, createApp, updateForApp } from './app'
import { DEFAULT_ALLOWED_ORIGINS } from './auth'
import { getDefaultPlatformDatabase } from './db/client'
import { platformHomePath } from './home'
import { readEnvironmentIdentity } from './db/environment-identity'
import {
  operatorErrorSummary,
  flushObservability,
  initializeObservability,
  recordProcessError,
  recordProcessInfo,
  recordProcessWarning,
  runDetached,
  serverErrors,
} from './observability'
import { defaultSecretsFilePath, defaultSettingsFilePath } from './settings/paths'
import { settingsPolicyFromEnv } from './settings/policy'
import type { RestartRecord } from './update/service'
import { readStagedRelease } from './update/staged-release'
import { readReleaseInfoSync, releaseFileFor } from './web/release'

type StopReason = NodeJS.Signals | { reason: 'restart'; record: RestartRecord }

const port = Number(Bun.env.PORT ?? 3001)
const hostname = Bun.env.FS_HOST ?? Bun.env.HOST ?? '127.0.0.1'
const homeDirectory = homedir()
const systemRoot = Bun.env.FS_SYSTEM_ROOT ?? path.parse(homeDirectory).root
const configuredWorkspaceRoot = Bun.env.FS_WORKSPACE_ROOT
const workspaceRoot = configuredWorkspaceRoot ?? systemRoot
const watch = Bun.env.FS_WATCH !== 'false'
const webRoot = Bun.env.WEB_ROOT
// Deleted so a PTY or agent this server starts cannot read production's `pending`. Bun.spawn
// without an `env` still passes the original environ; user-facing spawns pass `env`.
const productionRoot = Bun.env.PLATFORM_PRODUCTION_ROOT || null
delete process.env.PLATFORM_PRODUCTION_ROOT
const serverReleaseFile = releaseFileFor(import.meta.dirname)
const serverRelease = readReleaseInfoSync(serverReleaseFile).release
const configuredOrigins = allowedOriginsFromEnv(Bun.env.SERVER_ALLOWED_ORIGINS)
// The server serves the page itself, so its own loopback address is a web origin.
const allowedOrigins = unique([
  ...(configuredOrigins ?? DEFAULT_ALLOWED_ORIGINS),
  ...loopbackOrigins(hostname, port),
])
const maxTextFileBytes = numberFromEnv(Bun.env.FS_DEV_MAX_TEXT_FILE_BYTES)
const treeConcurrency = numberFromEnv(Bun.env.FS_TREE_CONCURRENCY)
let serverShutdown: Promise<void> | null = null
// Module scope: a SIGTERM during a Restart must not start a second exit path.
let stopping = false

assertLoopbackHost(hostname)
initializeObservability(Bun.env, readReleaseInfoSync(webRoot ? releaseFileFor(webRoot) : undefined))
installCrashHandlers()

export const app = createApp({
  auth: { allowedOrigins },
  homeDirectory,
  maxTextFileBytes,
  orchestration: { providerRuntime: true },
  settings: {
    policy: settingsPolicyFromEnv(Bun.env),
    secretsFilePath: defaultSecretsFilePath(),
    userFilePath: defaultSettingsFilePath(),
    watch: Bun.env.FS_WATCH !== 'false',
  },
  systemRoot,
  themes: { seedWallpapers: true },
  treeConcurrency,
  watch,
  update: {
    root: productionRoot,
    // After the POST answer flushes; closeApp runs before the listener stops.
    restart: (record) => setImmediate(() => stop({ reason: 'restart', record })),
  },
  mcp: { endpoint: `http://${hostname === '::1' ? '[::1]' : hostname}:${port}/mcp` },
  web: { root: webRoot, serverReleaseFile },
  webOrigin: configuredOrigins?.[0] ?? loopbackOrigins(hostname, port)[0],
  workspaceRoot: configuredWorkspaceRoot,
})
// A separate statement: Bun runs this callback inside listen(), before a chained `app` exists.
app.listen({ hostname, port }, (server) => {
  recordProcessInfo('server.start', {
    environmentId: readEnvironmentIdentity(getDefaultPlatformDatabase()).id,
    homeDirectory,
    hostname: server.hostname,
    pendingRelease: readStagedRelease(productionRoot, serverRelease).staged?.release ?? null,
    port: server.port,
    productionRoot,
    stateRoot: platformHomePath(),
    systemRoot,
    webRoot: webRoot ?? null,
    workspaceRoot,
  })
})
installShutdownHandlers()
installUpdateHandler()

export type App = typeof app

// Installing a rejection handler replaces Bun's automatic exit, so cleanup must end in exit 1.
function installCrashHandlers() {
  let crashing = false

  process.on('unhandledRejection', (reason) => {
    if (crashing) return

    crashing = true
    recordProcessError('server.unhandled_rejection', { error: operatorErrorSummary(reason) })
    void crash()
  })
}

async function crash() {
  try {
    await shutdownServer()
  } catch (error) {
    recordProcessWarning('server.stop_failed', {
      error: errorMessage(error),
      reason: 'unhandledRejection',
    })
  }
  await flushObservability()
  process.exit(1)
}

function shutdownServer() {
  if (serverShutdown) return serverShutdown
  serverShutdown = closeApp(app).then(async () => {
    await app.stop(true)
  })
  return serverShutdown
}

function installShutdownHandlers() {
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

// Unconditional, so an answered /release proves SIGUSR2 no longer terminates this server.
function installUpdateHandler() {
  process.on('SIGUSR2', () => {
    runDetached(async () => updateForApp(app).reread('signal'), {
      area: 'update',
      operation: 'reread',
    })
  })
}

function stop(reason: StopReason) {
  if (stopping) return

  stopping = true
  void stopServer(reason)
}

// A signal stop has systemd's stop timeout behind it; a Restart has nothing, so it sets its own.
const RESTART_DEADLINE_MS = 20_000

async function stopServer(reason: StopReason) {
  recordProcessInfo('server.stop', stopEvent(reason))
  if (typeof reason !== 'string') armRestartDeadline()

  try {
    await shutdownServer()
  } catch (error) {
    recordProcessWarning('server.stop_failed', {
      error: errorMessage(error),
      reason: typeof reason === 'string' ? reason : reason.reason,
    })
    await flushObservability()
    process.exit(1)
  }

  process.exit(exitCode(reason))
}

function armRestartDeadline() {
  const timer = setTimeout(() => {
    recordProcessWarning('server.stop_deadline', { deadlineMs: RESTART_DEADLINE_MS })
    void flushObservability().finally(() => process.exit(RESTART_EXIT_CODE))
  }, RESTART_DEADLINE_MS)
  timer.unref()
}

function stopEvent(reason: StopReason) {
  if (typeof reason === 'string') {
    return {
      reason,
      trigger: 'signal',
      release: { from: serverRelease },
      pendingRelease: updateForApp(app).state().pending?.release ?? null,
    }
  }

  const { record } = reason
  return {
    reason: 'restart',
    trigger: record.trigger,
    release: { from: record.from, to: record.to },
    stagedAt: record.stagedAt,
    stagedForMs: Date.now() - Date.parse(record.stagedAt),
    interrupted: record.interrupted,
    interruptedCount: record.interrupted.length,
    clientInstance: record.clientInstance,
  }
}

function allowedOriginsFromEnv(value: string | undefined) {
  if (!value) return undefined

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return origins.length > 0 ? origins : undefined
}

function loopbackOrigins(host: string, port: number) {
  const hosts = host === '::1' ? ['[::1]'] : ['localhost', '127.0.0.1']
  return hosts.map((name) => `http://${name}:${port}`)
}

function numberFromEnv(value: string | undefined) {
  if (!value) return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function assertLoopbackHost(host: string) {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return

  throw serverErrors.LOOPBACK_HOST_REQUIRED({ internal: { host, port } })
}

// 75 (EX_TEMPFAIL) is the unit's RestartForceExitStatus: systemd starts the staged release.
const RESTART_EXIT_CODE = 75

function exitCode(reason: StopReason) {
  if (reason === 'SIGINT') return 130
  if (reason === 'SIGTERM') return 143
  if (typeof reason === 'object') return RESTART_EXIT_CODE

  return 0
}
