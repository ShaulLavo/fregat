import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_START_TIMEOUT_MS = 15_000
const SERVER_STOP_TIMEOUT_MS = 5_000
const DEFAULT_BROWSER_PORT = '5179'
const DEFAULT_FILE_SERVER_URL = 'http://127.0.0.1:33201'

// Vitest runs global setup once for the project and again for each `browser.instances` entry,
// in one process. They share one server; the last teardown stops it.
type SharedServer = { ready: Promise<() => Promise<void>>; users: number }
const sharedKey = Symbol.for('platform.browser-file-server')
const registry = globalThis as typeof globalThis & { [sharedKey]?: SharedServer }

export default async function setupBrowserFileServer() {
  const shared = (registry[sharedKey] ??= { ready: startBrowserFileServer(), users: 0 })
  shared.users += 1
  const stop = await shared.ready

  return async () => {
    shared.users -= 1
    if (shared.users > 0) return

    delete registry[sharedKey]
    await stop()
  }
}

async function startBrowserFileServer() {
  const serverUrl = new URL(process.env.VITEST_BROWSER_FILE_SERVER_URL ?? DEFAULT_FILE_SERVER_URL)
  const browserPort = process.env.VITEST_BROWSER_PORT ?? DEFAULT_BROWSER_PORT
  await assertPortFree(serverUrl, browserPort)
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'platform-browser-'))
  const server = startServer(serverUrl, browserPort, runtimeRoot)

  try {
    await waitForServer(server, serverUrl, browserPort)
  } catch (error) {
    await cleanupServer(server, runtimeRoot)
    throw error
  }

  return () => cleanupServer(server, runtimeRoot)
}

async function cleanupServer(server: TrackedServer, runtimeRoot: string) {
  try {
    await stopServer(server)
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true })
  }
}

function startServer(serverUrl: URL, browserPort: string, runtimeRoot: string) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  const serverRoot = path.join(repoRoot, 'apps/server')
  const fixtureRoot = path.join(repoRoot, 'apps/web/test/fixtures/workbench-file-server')
  const hostname = loopbackHostname(serverUrl.hostname)
  const server = spawn('bun', ['src/index.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      FS_METADATA_DB: ':memory:',
      FS_HOST: hostname,
      FS_SYSTEM_ROOT: fixtureRoot,
      FS_WATCH: 'false',
      FS_WORKSPACE_ROOT: fixtureRoot,
      PORT: serverUrl.port,
      PLATFORM_SETTINGS_FILE: path.join(runtimeRoot, 'settings.json'),
      PLATFORM_SECRETS_FILE: path.join(runtimeRoot, 'secrets.json'),
      SERVER_ALLOWED_ORIGINS: allowedOrigins(browserPort).join(','),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return trackServerOutput(server)
}

async function waitForServer(server: TrackedServer, serverUrl: URL, browserPort: string) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS
  let lastError = 'server has not responded yet'

  while (Date.now() < deadline) {
    if (server.process.exitCode !== null) {
      throw new Error(serverErrorMessage('Browser file server exited before startup', server))
    }

    try {
      const response = await fetch(new URL('/health', serverUrl), {
        headers: { origin: `http://127.0.0.1:${browserPort}` },
      })
      if (response.ok) return

      lastError = `health returned ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(100)
  }

  throw new Error(serverErrorMessage(`Browser file server did not start: ${lastError}`, server))
}

// The readiness poll only asks the port for /health, so a server left over from an earlier run
// would answer it and every test would run against that stale build.
async function assertPortFree(serverUrl: URL, browserPort: string) {
  const answered = await fetch(new URL('/health', serverUrl), {
    headers: { origin: `http://127.0.0.1:${browserPort}` },
  }).then(
    () => true,
    () => false,
  )
  if (!answered) return

  throw new Error(
    `Browser file server port ${serverUrl.port} is already serving; stop the leftover process (ss -ltnp | grep ${serverUrl.port})`,
  )
}

async function stopServer(server: TrackedServer) {
  if (server.process.exitCode !== null) return

  const exited = waitForExit(server.process)
  server.process.kill('SIGTERM')

  const stopped = await Promise.race([exited.then(() => true), delay(SERVER_STOP_TIMEOUT_MS)])
  if (stopped) return

  server.process.kill('SIGKILL')
  await exited
}

type TrackedServer = {
  output: () => string
  process: ChildProcessWithoutNullStreams
}

function trackServerOutput(process: ChildProcessWithoutNullStreams): TrackedServer {
  const chunks: string[] = []
  const append = (chunk: Buffer) => {
    chunks.push(chunk.toString('utf8'))
    if (chunks.length > 40) chunks.shift()
  }

  process.stdout.on('data', append)
  process.stderr.on('data', append)

  return {
    output: () => chunks.join('').trim(),
    process,
  }
}

function waitForExit(process: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve) => {
    process.once('exit', () => resolve())
  })
}

function allowedOrigins(browserPort: string) {
  return [
    `http://127.0.0.1:${browserPort}`,
    `http://localhost:${browserPort}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]
}

function loopbackHostname(hostname: string) {
  if (hostname === 'localhost') return '127.0.0.1'
  if (hostname === '127.0.0.1') return hostname

  throw new Error(`Browser file server must use a loopback host, received ${hostname}`)
}

function serverErrorMessage(message: string, server: TrackedServer) {
  const output = server.output()
  if (!output) return message

  return `${message}\n\n${output}`
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
