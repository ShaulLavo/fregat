import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import type { SettingsValues } from '../../packages/contracts/src/settings/keys'

import {
  DEFAULT_PROVIDER_INSTANCES,
  HARNESS_FIXTURE_ROOT_ENV,
  HARNESS_REAL_PROVIDERS_ENV,
} from '../../apps/server/src/provider/drivers/built-in'

import { promote } from '../deploy/systemd/promote'
import { stopTerminalHost } from '../../apps/server/src/terminal-host/identity'
import { hostPaths } from '../../apps/server/src/terminal-host/protocol'

import { allowedOriginsForWebPort } from '../runtime-network'
import { linkWallpaperLibrary, productionStateHome } from '../state-home'
import { createScriptError } from '../structured-errors'
import { fixtureReadiness } from './fixture-readiness'
import { scratchRoot as defaultScratchRoot } from './paths'

const SERVER_ROOT = path.resolve(import.meta.dirname, '../../apps/server')
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000
// The server's exit after Restart, the unit's RestartForceExitStatus.
const RESTART_EXIT_CODE = 75

export type IsolatedServer = {
  readonly port: number
  readonly origin: string
  readonly directory: string
  readonly home: string
  readonly logs: string
  /** The server's `PLATFORM_PRODUCTION_ROOT`: stage a release by linking `pending` here. */
  readonly productionRoot: string
  /** How long the supervisor waits after a Restart exit before starting the server again. */
  restartDelayMs: number
  signal(signal: NodeJS.Signals): void
  stop(options?: { readonly logs: string }): Promise<void>
}

/**
 * One throwaway API server per `agent:browser` run: its own port, state home and log
 * directory under the OS temporary directory, all removed when the run ends. The Vite page reaches
 * it through `window.platformDevServerUrl`.
 */
export async function startIsolatedServer(
  webOrigin: URL | undefined,
  {
    pathPrefix,
    releaseRoot,
    handleSignals = true,
    realProviders = false,
    webRoot,
    settings = {},
    scratchRoot = defaultScratchRoot,
  }: {
    pathPrefix?: string
    releaseRoot?: string
    handleSignals?: boolean
    realProviders?: boolean
    scratchRoot?: string
    webRoot?: string
    settings?: Partial<SettingsValues>
  } = {},
): Promise<IsolatedServer> {
  if (
    releaseRoot &&
    (!existsSync(path.join(releaseRoot, 'server', 'index.js')) ||
      !existsSync(path.join(releaseRoot, 'build-config.json')))
  )
    throw createScriptError(
      'The isolated backend requires a built release with its build descriptor.',
    )
  const directory = mkdtempSync(path.join(scratchRoot, 'fregat-agent-'))
  const home = path.join(directory, 'home')
  const logs = path.join(directory, 'logs')
  const productionRoot = path.join(directory, 'production')
  mkdirSync(home)
  mkdirSync(productionRoot)
  const servedWeb = path.join(directory, 'served', 'web')
  mkdirSync(servedWeb, { recursive: true })
  // Keep web and server release descriptors beside each other when promotion updates them.
  if (webRoot)
    for (const name of readdirSync(webRoot))
      symlinkSync(path.resolve(webRoot, name), path.join(servedWeb, name))
  const entry = releaseRoot
    ? path.join(path.resolve(releaseRoot), 'server', 'index.js')
    : isolatedReleaseEntry(directory)
  if (releaseRoot)
    copyFileSync(
      path.join(releaseRoot, 'build-config.json'),
      path.join(directory, 'served', 'build-config.json'),
    )
  // Scenarios install their own fixture drivers; only an owner's --real-providers run keeps the
  // built-in accounts on.
  if (!realProviders || Object.keys(settings).length > 0)
    writeFileSync(
      path.join(home, 'settings.json'),
      JSON.stringify({
        ...settings,
        'workbench.wallpaper': { enabled: false, source: { kind: 'desktop' } },
        ...(!realProviders
          ? {
              'providers.instances': DEFAULT_PROVIDER_INSTANCES.map((provider) => ({
                ...provider,
                enabled: false,
              })),
            }
          : {}),
      }),
    )
  const port = await prepareHome(home).catch((error: unknown) => {
    rmSync(directory, { recursive: true, force: true })
    throw error
  })
  webOrigin ??= new URL(`http://localhost:${port}`)
  const env = isolatedServerEnv({
    home,
    logs,
    pathPrefix,
    port,
    productionRoot,
    realProviders,
    scratchRoot,
    webOrigin,
    webRoot: servedWeb,
  })
  const spawn = () =>
    Bun.spawn({
      cmd: [
        releaseRoot && existsSync(path.join(releaseRoot, 'bin', 'bun'))
          ? path.join(releaseRoot, 'bin', 'bun')
          : process.execPath,
        '--preload',
        new URL('./push-boundary.ts', import.meta.url).pathname,
        entry,
      ],
      cwd: SERVER_ROOT,
      env,
      stderr: Bun.file(path.join(directory, 'server.stderr')),
      stdout: Bun.file(path.join(directory, 'server.stdout')),
    })
  let child = spawn()
  const origin = `http://localhost:${port}`
  let stopping: Promise<void> | undefined
  // Prod's RestartSec.
  let restartDelayMs = 250
  // Plays systemd's part: a Restart exit promotes the approved release and starts the server again.
  const supervise = async (exited: Bun.Subprocess) => {
    if ((await exited.exited) !== RESTART_EXIT_CODE || stopping) return
    const promoted = promote(productionRoot, () => true)
    if (promoted === 'promoted') {
      const current = realpathSync(path.join(productionRoot, 'current'))
      copyFileSync(
        path.join(current, 'build-config.json'),
        path.join(directory, 'served', 'build-config.json'),
      )
    }
    await Bun.sleep(restartDelayMs)
    if (stopping) return
    child = spawn()
    void supervise(child)
  }
  void supervise(child)
  const stop: IsolatedServer['stop'] = (options) => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    return (stopping ??= stopServer(child, directory, options?.logs))
  }
  const onSignal = (signal: NodeJS.Signals) => {
    void stop().finally(() => process.kill(process.pid, signal))
  }
  if (handleSignals) {
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
  }
  try {
    await waitForHealth(child, origin, webOrigin.origin, directory)
  } catch (error) {
    await stop()
    throw error
  }
  const signal = (name: NodeJS.Signals) => {
    if (child.exitCode === null) child.kill(name)
  }
  return {
    port,
    origin,
    directory,
    home,
    logs,
    productionRoot,
    get restartDelayMs() {
      return restartDelayMs
    },
    set restartDelayMs(ms: number) {
      restartDelayMs = ms
    },
    signal,
    stop,
  }
}

// The entry's release identity belongs to this run; imported services still use checkout source.
function isolatedReleaseEntry(directory: string) {
  const source = path.join(SERVER_ROOT, 'src')
  const server = path.join(directory, 'served', 'server')
  mkdirSync(server)
  for (const name of readdirSync(source)) {
    if (name === 'index.ts') copyFileSync(path.join(source, name), path.join(server, name))
    else symlinkSync(path.join(source, name), path.join(server, name))
  }
  symlinkSync(path.join(SERVER_ROOT, 'node_modules'), path.join(server, 'node_modules'))
  return path.join(server, 'index.ts')
}

/**
 * The throwaway server's environment. Codex and Claude run only fixture binaries under
 * `scratchRoot` unless the owner passed `--real-providers`; an inherited opt-in is dropped.
 */
export function isolatedServerEnv(input: {
  home: string
  logs: string
  pathPrefix?: string
  port: number
  productionRoot: string
  realProviders: boolean
  scratchRoot: string
  webOrigin: URL
  webRoot?: string
}) {
  const { home, logs, pathPrefix, port, productionRoot, webOrigin } = input
  const env: Record<string, string | undefined> = {
    ...process.env,
    FS_HOST: '127.0.0.1',
    FS_SYSTEM_ROOT: path.parse(input.scratchRoot).root,
    FS_WORKSPACE_ROOT: path.parse(input.scratchRoot).root,
    FS_METADATA_DB: path.join(home, 'fs-metadata.sqlite'),
    OBSERVABILITY_DIR: logs,
    PATH: pathPrefix ? `${pathPrefix}${path.delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
    // Offers the mock provider driver, so a scenario can script a whole turn.
    PLATFORM_AGENT_HARNESS: '1',
    [HARNESS_FIXTURE_ROOT_ENV]: input.scratchRoot,
    PLATFORM_HOME: home,
    PLATFORM_PRODUCTION_ROOT: productionRoot,
    WEB_ROOT: input.webRoot ?? path.join(home, '..', 'served', 'web'),
    PORT: String(port),
    SERVER_ALLOWED_ORIGINS: allowedOriginsForWebPort(
      `http://localhost:${port},http://127.0.0.1:${port},http://[::1]:${port}`,
      webOrigin.hostname,
      Number(webOrigin.port),
    ),
  }
  delete env[HARNESS_REAL_PROVIDERS_ENV]
  if (input.realProviders) env[HARNESS_REAL_PROVIDERS_ENV] = '1'

  return env
}

async function prepareHome(home: string) {
  if (existsSync(path.join(productionStateHome, 'wallpapers'))) linkWallpaperLibrary(home)
  const listener = net.createServer()
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen({ exclusive: true, host: '127.0.0.1', port: 0 }, resolve)
  })
  const address = listener.address()
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  )
  if (address === null || typeof address === 'string')
    throw createScriptError('The isolated API port probe did not return a TCP address.')
  return address.port
}

export async function waitForHealth(
  child: Bun.Subprocess,
  origin: string,
  webOrigin: string,
  directory: string,
) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()))
    const healthy = await ownServerReadiness(child, origin, webOrigin, directory, signal).catch(
      () => false,
    )
    if (healthy && child.exitCode === null) return
    await Bun.sleep(100)
  }
  const stderr = await Bun.file(path.join(directory, 'server.stderr'))
    .text()
    .catch(() => '')
  throw createScriptError(
    `Isolated API server on ${origin} did not become healthy (exit ${child.exitCode ?? 'none'}).\n${stderr.slice(-2000)}`,
  )
}

async function ownServerReadiness(
  child: Bun.Subprocess,
  origin: string,
  webOrigin: string,
  directory: string,
  signal: AbortSignal,
) {
  const fetcher = async (url: URL, init: RequestInit) => {
    if (child.exitCode !== null) return Response.error()
    const response = await fetch(url, init)
    if (url.pathname !== '/health' || !response.ok) return response
    const descriptor: unknown = await response.clone().json()
    const own =
      typeof descriptor === 'object' &&
      descriptor !== null &&
      'metadataDbPath' in descriptor &&
      descriptor.metadataDbPath === path.join(directory, 'home', 'fs-metadata.sqlite')
    return own && child.exitCode === null ? response : Response.error()
  }
  return (await fixtureReadiness(new URL(origin), webOrigin, { fetcher, signal })).ok
}

async function stopServer(child: Bun.Subprocess, directory: string, logs?: string) {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    const stopped = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(STOP_TIMEOUT_MS).then(() => false),
    ])
    if (!stopped) child.kill('SIGKILL')
    await child.exited
  }
  try {
    await stopTerminalHost(path.join(directory, 'home'))
    if (logs) copyServerLogs(directory, logs)
  } finally {
    rmSync(hostPaths(path.join(directory, 'home')).directory, { force: true, recursive: true })
    rmSync(directory, { force: true, recursive: true })
  }
}

function copyServerLogs(directory: string, destination: string) {
  const source = path.join(directory, 'logs')
  if (!existsSync(source)) return
  mkdirSync(destination, { recursive: true })
  for (const name of readdirSync(source)) {
    if (name.endsWith('.jsonl')) copyFileSync(path.join(source, name), path.join(destination, name))
  }
}
