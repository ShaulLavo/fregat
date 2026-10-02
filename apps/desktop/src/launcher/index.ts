import { accessSync, constants, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { errorMessage } from '@workspace/contracts'
import { launcherFailureFacts, reportStartFailure } from './failure'
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
import { launchInstalledWindow } from './installed-window'
import {
  ensureInstalledService,
  installationIntent,
  installationReleaseRoot,
} from './installation-client'
import { launchWebview, nativeHostBinary, showStartFailure } from './native-window'
import { nativeBudget } from './native-helper'
import { startupBudget } from './startup'
import { isRecord } from '@workspace/utils/objects'
import { desktopStateHome } from './profile'
import { launcherErrors } from './structured-errors'

const root = path.resolve(import.meta.dirname, '../../../..')
applyEnvFileOverrides(path.join(root, '.env'), Bun.env)
initializeDesktopObservability()
const controller = new AbortController()
let window: { exited: Promise<unknown>; close(): Promise<void> } | undefined
let helperBudget = nativeBudget()
const binary = nativeHostBinary(root)
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
    reportStartFailure(error, {
      log: (facts) => recordDesktopError('desktop.start_failed', facts),
      stderr: (line) => console.error(line),
      exit: (code) => {
        process.exitCode = code
      },
    })
    try {
      await showStartFailure(error, { binary, signal: controller.signal, budget: helperBudget })
    } catch (messageError) {
      if (!controller.signal.aborted)
        recordDesktopError('desktop.start_message_failed', launcherFailureFacts(messageError))
    }
  }
} finally {
  await window?.close()
  await flushDesktopObservability()
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}

async function start() {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw launcherErrors.LAUNCH_FAILED({
      internal: { platform: process.platform, supportedPlatforms: ['linux', 'darwin'] },
    })
  const mode = Bun.argv.includes('--dev') ? 'dev' : 'production'
  const home = homedir()
  const stateHome = desktopStateHome({ PLATFORM_HOME: Bun.env.PLATFORM_HOME }, home, mode)
  let web: string
  let server: string
  if (mode === 'dev') {
    web = runtimeUrl(Bun.env.WEB_HOST ?? '127.0.0.1', portFromEnv(Bun.env, 'WEB_PORT', 5173))
    server = runtimeUrl(Bun.env.FS_HOST ?? '127.0.0.1', portFromEnv(Bun.env, 'PORT', 3001))
    recordDesktopInfo('desktop.shared_dev.wait')
    await waitForHttp(`${server}/health`, web)
    await waitForHttp(web, web)
  } else {
    const service = await ensureInstalledService({
      intent: installationIntent(stateHome),
      productionRoot: installationReleaseRoot(stateHome, home),
      signal: controller.signal,
    })
    web = service.url
    server = service.url.replace(/\/$/, '')
    recordDesktopInfo('desktop.service.ready', { disposition: service.disposition })
  }
  const settings = await readSettings(server, web)
  helperBudget = settings.native
  const candidates = resolveBrowserCandidates(
    settings.browser,
    settings.transparency,
    {
      home,
      platform: process.platform,
      path: Bun.env.PATH || '',
      configHome: Bun.env.XDG_CONFIG_HOME,
      configDirs: Bun.env.XDG_CONFIG_DIRS,
      dataHome: Bun.env.XDG_DATA_HOME,
      dataDirs: Bun.env.XDG_DATA_DIRS,
      currentDesktop: Bun.env.XDG_CURRENT_DESKTOP,
    },
    { readFile: safeRead, exists: executableExists },
  )
  recordDesktopInfo('desktop.browser.detect', {
    candidates: candidates.map((candidate) =>
      candidate.kind === 'chromium'
        ? { kind: candidate.kind, source: candidate.source, confinement: candidate.confinement }
        : { kind: candidate.kind },
    ),
  })
  const openNative = () =>
    launchWebview({
      binary,
      url: web,
      signal: controller.signal,
      budget: settings.native,
      startup: settings.startup,
      vibrancy: settings.transparency === 'window',
      onOpen: (context) => recordDesktopInfo('desktop.window.open', context),
    })
  for (const candidate of candidates) {
    controller.signal.throwIfAborted()
    if (candidate.kind === 'webview') {
      try {
        window = await openNative()
      } catch (error) {
        if (controller.signal.aborted) throw error
        recordDesktopInfo('desktop.browser.rejected', {
          engine: process.platform === 'darwin' ? 'wkwebview' : 'webkitgtk',
          ...launcherFailureFacts(error),
        })
        continue
      }
      await window.exited
      return
    }
    if (candidate.kind === 'tab') {
      recordDesktopInfo('desktop.window.degraded', {
        engine: 'tab',
        reason: 'controlled-browser-unavailable',
      })
      const child = Bun.spawn({
        cmd: [process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', web],
        stdio: ['ignore', 'ignore', 'ignore'],
      })
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
      const result = await launchInstalledWindow({
        native: openNative,
        onUnsupported: (error) =>
          recordDesktopInfo('desktop.browser.installation_unavailable', {
            source: candidate.source,
            ...launcherFailureFacts(error),
          }),
        browser: {
          candidate,
          stateHome,
          home,
          url: web,
          startup: settings.startup,
          signal: controller.signal,
          onOpen: (context) => recordDesktopInfo('desktop.window.open', context),
        },
      })
      recordDesktopInfo('desktop.browser.chosen', {
        source: candidate.source,
        outcome: result.kind,
      })
      if (result.kind === 'handoff') return
      window = result
      await window.exited
      return
    } catch (error) {
      if (controller.signal.aborted) throw error
      recordDesktopInfo('desktop.browser.rejected', {
        outcome: 'rejected',
        source: candidate.source,
        confinement: candidate.confinement,
        ...launcherFailureFacts(error),
      })
      throw error
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
      return {
        browser: 'auto',
        transparency: 'compositor',
        startup: startupBudget(),
        native: nativeBudget(),
      }
    return {
      browser: snapshot.values['window.browser'] ?? 'auto',
      transparency: snapshot.values['window.transparency'] ?? 'compositor',
      startup: startupBudget(snapshot.values),
      native: nativeBudget(snapshot.values),
    }
  } catch (error) {
    controller.signal.throwIfAborted()
    recordDesktopInfo('desktop.settings.unreachable', { error: errorMessage(error) })
    return {
      browser: 'auto',
      transparency: 'compositor',
      startup: startupBudget(),
      native: nativeBudget(),
    }
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
