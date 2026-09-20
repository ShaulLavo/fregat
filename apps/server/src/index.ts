import { unique } from '@workspace/utils/collections'
import { errorMessage } from '@workspace/contracts'
import { homedir } from 'node:os'
import path from 'node:path'
import { closeApp, createApp } from './app'
import { DEFAULT_ALLOWED_ORIGINS } from './auth'
import { getDefaultPlatformDatabase } from './db/client'
import { readEnvironmentIdentity } from './db/environment-identity'
import {
  errorSummary,
  flushObservability,
  initializeObservability,
  recordProcessError,
  recordProcessInfo,
  recordProcessWarning,
  serverErrors,
} from './observability'
import { defaultSecretsFilePath, defaultSettingsFilePath } from './settings/paths'
import { settingsPolicyFromEnv } from './settings/policy'
import { releaseFileFor } from './web/release'

const port = Number(Bun.env.PORT ?? 3001)
const hostname = Bun.env.FS_HOST ?? Bun.env.HOST ?? '127.0.0.1'
const homeDirectory = homedir()
const systemRoot = Bun.env.FS_SYSTEM_ROOT ?? path.parse(homeDirectory).root
const configuredWorkspaceRoot = Bun.env.FS_WORKSPACE_ROOT
const workspaceRoot = configuredWorkspaceRoot ?? systemRoot
const watch = Bun.env.FS_WATCH !== 'false'
const webRoot = Bun.env.WEB_ROOT
const configuredOrigins = allowedOriginsFromEnv(Bun.env.SERVER_ALLOWED_ORIGINS)
// The server serves the page itself, so its own loopback address is a web origin.
const allowedOrigins = unique([
  ...(configuredOrigins ?? DEFAULT_ALLOWED_ORIGINS),
  ...loopbackOrigins(hostname, port),
])
const maxTextFileBytes = numberFromEnv(Bun.env.FS_DEV_MAX_TEXT_FILE_BYTES)
const treeConcurrency = numberFromEnv(Bun.env.FS_TREE_CONCURRENCY)
let serverShutdown: Promise<void> | null = null

assertLoopbackHost(hostname)
initializeObservability(Bun.env)
installCrashHandlers()

export const app = createApp({
  auth: { allowedOrigins },
  homeDirectory,
  maxTextFileBytes,
  orchestration: { providerRuntime: true },
  settings: {
    policy: settingsPolicyFromEnv(Bun.env),
    secretsFilePath: Bun.env.PLATFORM_SECRETS_FILE ?? defaultSecretsFilePath(),
    userFilePath: Bun.env.PLATFORM_SETTINGS_FILE ?? defaultSettingsFilePath(),
    watch: Bun.env.FS_WATCH !== 'false',
  },
  systemRoot,
  treeConcurrency,
  watch,
  web: { root: webRoot, serverReleaseFile: releaseFileFor(import.meta.dirname) },
  webOrigin: configuredOrigins?.[0] ?? loopbackOrigins(hostname, port)[0],
  workspaceRoot: configuredWorkspaceRoot,
}).listen({ hostname, port }, (server) => {
  recordProcessInfo('server.start', {
    environmentId: readEnvironmentIdentity(getDefaultPlatformDatabase()).id,
    homeDirectory,
    hostname: server.hostname,
    port: server.port,
    systemRoot,
    webRoot: webRoot ?? null,
    workspaceRoot,
  })
})
installShutdownHandlers()

export type App = typeof app

// Installing a rejection handler replaces Bun's automatic exit, so cleanup must end in exit 1.
function installCrashHandlers() {
  let crashing = false

  process.on('unhandledRejection', (reason) => {
    if (crashing) return

    crashing = true
    recordProcessError('server.unhandled_rejection', { error: errorSummary(reason) })
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
  let stopping = false

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return

    stopping = true
    void stopServer(signal)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

async function stopServer(signal: NodeJS.Signals) {
  recordProcessInfo('server.stop', { signal })

  try {
    await shutdownServer()
  } catch (error) {
    recordProcessWarning('server.stop_failed', {
      error: errorMessage(error),
      signal,
    })
    await flushObservability()
    process.exit(1)
  }

  process.exit(exitCodeForSignal(signal))
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

  throw serverErrors.LOOPBACK_HOST_REQUIRED()
}

function exitCodeForSignal(signal: NodeJS.Signals) {
  if (signal === 'SIGINT') return 130
  if (signal === 'SIGTERM') return 143

  return 0
}
