import { accessSync, constants, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { errorMessage } from '@workspace/contracts'
import { EvlogError } from 'evlog'
import { applyEnvFileOverrides } from '@workspace/observability/env-file'
import { portFromEnv, runtimeUrl } from '../../../../scripts/runtime-network'
import { desktopErrors } from '../bun/structured-errors'
import {
  initializeDesktopObservability,
  flushDesktopObservability,
  recordDesktopInfo,
  recordDesktopError,
} from '../bun/observability'
import { resolveBrowserCandidates } from './browser'
import { launchChromium, type ChromiumWindow } from './chromium'
import { isRecord } from '@workspace/utils/objects'
import { desktopStateHome } from './profile'
import { launcherErrors } from './structured-errors'

const root = path.resolve(import.meta.dirname, '../../../..')
applyEnvFileOverrides(path.join(root, '.env'), Bun.env)
initializeDesktopObservability()
const controller = new AbortController()
let window: Extract<ChromiumWindow, { kind: 'owned' }> | undefined
const stop = () => {
  controller.abort()
  void window?.close()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  await start()
} catch (error) {
  if (!controller.signal.aborted) {
    recordDesktopError('desktop.start_failed', {
      error: errorMessage(error),
      code: error instanceof EvlogError ? error.code : undefined,
      internal: error instanceof EvlogError ? error.internal : undefined,
    })
    console.error(
      `Platform could not start. ${errorMessage(error)} ${error instanceof EvlogError ? (error.fix ?? '') : ''}`,
    )
    process.exitCode = 1
  }
} finally {
  await window?.close()
  await flushDesktopObservability()
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}

async function start() {
  if (process.platform !== 'linux')
    throw launcherErrors.LAUNCH_FAILED({
      internal: { platform: process.platform, supportedPlatform: 'linux' },
    })
  const web = runtimeUrl(Bun.env.WEB_HOST ?? '127.0.0.1', portFromEnv(Bun.env, 'WEB_PORT', 5173))
  const server = runtimeUrl(Bun.env.FS_HOST ?? '127.0.0.1', portFromEnv(Bun.env, 'PORT', 3001))
  recordDesktopInfo('desktop.shared_dev.wait')
  await waitForHttp(`${server}/health`, web)
  await waitForHttp(web, web)
  const settings = await readSettings(server, web)
  const home = homedir()
  const stateHome = desktopStateHome(
    { PLATFORM_HOME: Bun.env.PLATFORM_HOME },
    home,
    Bun.argv.includes('--dev') ? 'dev' : 'production',
  )
  const candidates = resolveBrowserCandidates(
    settings.browser,
    settings.transparency,
    {
      home,
      path: Bun.env.PATH || '',
      configHome: Bun.env.XDG_CONFIG_HOME,
      configDirs: Bun.env.XDG_CONFIG_DIRS,
      dataHome: Bun.env.XDG_DATA_HOME,
      dataDirs: Bun.env.XDG_DATA_DIRS,
      currentDesktop: Bun.env.XDG_CURRENT_DESKTOP,
    },
    { readFile: safeRead, exists: executableExists },
  )
  recordDesktopInfo('desktop.browser.detect', { candidates })
  for (const candidate of candidates) {
    controller.signal.throwIfAborted()
    if (candidate.kind === 'webview') continue
    if (candidate.kind === 'tab') {
      recordDesktopInfo('desktop.window.degraded', {
        engine: 'tab',
        reason: 'controlled-browser-unavailable',
      })
      const child = Bun.spawn({ cmd: ['xdg-open', web], stdio: ['ignore', 'ignore', 'ignore'] })
      const stopOpener = () => child.kill('SIGTERM')
      controller.signal.addEventListener('abort', stopOpener, { once: true })
      try {
        if ((await child.exited) !== 0)
          throw launcherErrors.LAUNCH_FAILED({
            internal: { reason: 'tab-opener-exit', exitCode: child.exitCode },
          })
      } finally {
        controller.signal.removeEventListener('abort', stopOpener)
      }
      return
    }
    try {
      const result = await launchChromium({
        candidate,
        stateHome,
        home,
        url: web,
        signal: controller.signal,
        onOpen: (context) => recordDesktopInfo('desktop.window.open', context),
        onExit: (context) => recordDesktopInfo('desktop.window.closed', context),
        onFailure: (error) =>
          recordDesktopError('desktop.window.control_failed', { error: errorMessage(error) }),
      })
      recordDesktopInfo('desktop.browser.chosen', {
        source: candidate.source,
        path: candidate.executable,
        outcome: result.kind,
      })
      if (result.kind === 'handoff') return
      window = result
      await window.exited
      return
    } catch (error) {
      if (controller.signal.aborted) throw error
      recordDesktopInfo('desktop.browser.rejected', {
        source: candidate.source,
        confinement: candidate.confinement,
        error: errorMessage(error),
      })
    }
  }
}

async function readSettings(server: string, origin: string) {
  try {
    const response = await fetch(`${server}/settings`, {
      headers: { Origin: origin },
      signal: requestSignal(),
    })
    const snapshot: unknown = await response.json()
    if (!response.ok || !isRecord(snapshot) || !isRecord(snapshot.values))
      return { browser: 'auto', transparency: 'compositor' }
    return {
      browser: snapshot.values['window.browser'] ?? 'auto',
      transparency: snapshot.values['window.transparency'] ?? 'compositor',
    }
  } catch (error) {
    controller.signal.throwIfAborted()
    recordDesktopInfo('desktop.settings.unreachable', { error: errorMessage(error) })
    return { browser: 'auto', transparency: 'compositor' }
  }
}

async function waitForHttp(url: string, origin: string) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    controller.signal.throwIfAborted()
    try {
      const response = await fetch(url, { headers: { Origin: origin }, signal: requestSignal() })
      await response.body?.cancel()
      if (response.ok) return
    } catch {
      controller.signal.throwIfAborted()
    }
    await Bun.sleep(250)
  }
  throw desktopErrors.DEV_SERVER_UNREACHABLE({ url, internal: { waitedMs: 90_000 } })
}

function requestSignal() {
  return AbortSignal.any([controller.signal, AbortSignal.timeout(1500)])
}
function safeRead(file: string) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}
function executableExists(file: string) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}
