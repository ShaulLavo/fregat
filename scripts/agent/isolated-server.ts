import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'

import { allowedOriginsForWebPort, isPortAvailable, selectAvailablePort } from '../runtime-network'
import { linkWallpaperLibrary, productionStateHome } from '../state-home'
import { createScriptError } from '../structured-errors'

const SERVER_ROOT = path.resolve(import.meta.dirname, '../../apps/server')
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000

export type IsolatedServer = {
  readonly port: number
  readonly origin: string
  readonly directory: string
  readonly home: string
  readonly logs: string
  stop(): Promise<void>
}

/**
 * One throwaway API server per `agent:browser` run: its own port, state home and log
 * directory under `/work/tmp`, all removed when the run ends. The shared Vite page reaches
 * it through `window.platformDevServerUrl`.
 */
export async function startIsolatedServer(webOrigin: URL): Promise<IsolatedServer> {
  const directory = mkdtempSync('/work/tmp/fregat-agent-')
  const home = path.join(directory, 'home')
  const logs = path.join(directory, 'logs')
  mkdirSync(home)
  if (existsSync(path.join(productionStateHome, 'wallpapers'))) linkWallpaperLibrary(home)
  const port = await selectAvailablePort({
    isAvailable: (candidate) => isPortAvailable('127.0.0.1', candidate),
    preferredPort: 33_400,
  })
  const env: Record<string, string | undefined> = {
    ...process.env,
    FS_HOST: '127.0.0.1',
    OBSERVABILITY_DIR: logs,
    PLATFORM_HOME: home,
    PORT: String(port),
    SERVER_ALLOWED_ORIGINS: allowedOriginsForWebPort(
      undefined,
      webOrigin.hostname,
      Number(webOrigin.port),
    ),
  }
  delete env.FS_METADATA_DB
  const child = Bun.spawn({
    cmd: [process.execPath, 'src/index.ts'],
    cwd: SERVER_ROOT,
    env,
    stderr: Bun.file(path.join(directory, 'server.stderr')),
    stdout: Bun.file(path.join(directory, 'server.stdout')),
  })
  const origin = `http://localhost:${port}`
  let stopping: Promise<void> | undefined
  const stop = () => (stopping ??= stopServer(child, directory))
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
  return { port, origin, directory, home, logs, stop }
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
  rmSync(directory, { force: true, recursive: true })
}
