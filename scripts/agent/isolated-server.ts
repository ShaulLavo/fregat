import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'

import { promote } from '../deploy/systemd/promote'
import { stopTerminalHost } from '../../apps/server/src/terminal-host/identity'
import { hostPaths } from '../../apps/server/src/terminal-host/protocol'

import { allowedOriginsForWebPort, isPortAvailable, selectAvailablePort } from '../runtime-network'
import { linkWallpaperLibrary, productionStateHome } from '../state-home'
import { createScriptError } from '../structured-errors'

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
  stop(): Promise<void>
}

/**
 * One throwaway API server per `agent:browser` run: its own port, state home and log
 * directory under `/work/tmp`, all removed when the run ends. The shared Vite page reaches
 * it through `window.platformDevServerUrl`.
 */
export async function startIsolatedServer(
  webOrigin: URL,
  { pathPrefix, scratchRoot = '/work/tmp' }: { pathPrefix?: string; scratchRoot?: string } = {},
): Promise<IsolatedServer> {
  const directory = mkdtempSync(path.join(scratchRoot, 'fregat-agent-'))
  const home = path.join(directory, 'home')
  const logs = path.join(directory, 'logs')
  const productionRoot = path.join(directory, 'production')
  mkdirSync(home)
  mkdirSync(productionRoot)
  const port = await prepareHome(home, webOrigin).catch((error: unknown) => {
    rmSync(directory, { recursive: true, force: true })
    throw error
  })
  const env: Record<string, string | undefined> = {
    ...process.env,
    FS_HOST: '127.0.0.1',
    // The run copies this log before the server stops, so a 5 s batch would drop the run's tail.
    OBSERVABILITY_BATCH_INTERVAL_MS: '200',
    FS_METADATA_DB: path.join(home, 'fs-metadata.sqlite'),
    OBSERVABILITY_DIR: logs,
    PATH: pathPrefix ? `${pathPrefix}${path.delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
    // Offers the mock provider driver, so a scenario can script a whole turn.
    PLATFORM_AGENT_HARNESS: '1',
    PLATFORM_HOME: home,
    PLATFORM_PRODUCTION_ROOT: productionRoot,
    PORT: String(port),
    SERVER_ALLOWED_ORIGINS: allowedOriginsForWebPort(
      undefined,
      webOrigin.hostname,
      Number(webOrigin.port),
    ),
  }
  const spawn = () =>
    Bun.spawn({
      cmd: [
        process.execPath,
        '--preload',
        new URL('./push-boundary.ts', import.meta.url).pathname,
        'src/index.ts',
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
    promote(productionRoot, () => true)
    await Bun.sleep(restartDelayMs)
    if (stopping) return
    child = spawn()
    void supervise(child)
  }
  void supervise(child)
  const stop = () => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    return (stopping ??= stopServer(child, directory))
  }
  const onSignal = (signal: NodeJS.Signals) => {
    void stop().finally(() => process.kill(process.pid, signal))
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
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

async function prepareHome(home: string, webOrigin: URL) {
  if (existsSync(path.join(productionStateHome, 'wallpapers'))) linkWallpaperLibrary(home)
  return selectAvailablePort({
    isAvailable: (candidate) => isPortAvailable('127.0.0.1', candidate),
    // A band per web port: two worktrees probing one port at once can both see it free, and the
    // loser's health check then passes against the winner's server, which refuses its origin.
    preferredPort: 33_400 + (Number(webOrigin.port) % 100) * 10,
  })
}

async function waitForHealth(
  child: Bun.Subprocess,
  origin: string,
  webOrigin: string,
  directory: string,
) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    const healthy = await fetch(`${origin}/health`, { headers: { origin: webOrigin } }).then(
      (response) => response.ok,
      () => false,
    )
    if (healthy) return
    await Bun.sleep(100)
  }
  const stderr = await Bun.file(path.join(directory, 'server.stderr'))
    .text()
    .catch(() => '')
  throw createScriptError(
    `Isolated API server on ${origin} did not become healthy (exit ${child.exitCode ?? 'none'}).\n${stderr.slice(-2000)}`,
  )
}

async function stopServer(child: Bun.Subprocess, directory: string) {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    const stopped = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(STOP_TIMEOUT_MS).then(() => false),
    ])
    if (!stopped) child.kill('SIGKILL')
    await child.exited
  }
  await stopTerminalHost(path.join(directory, 'home'))
  rmSync(hostPaths(path.join(directory, 'home')).directory, { force: true, recursive: true })
  rmSync(directory, { force: true, recursive: true })
}
