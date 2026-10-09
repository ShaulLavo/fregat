import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isRecord } from '@workspace/utils/objects'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebviewHost, runNativeDialog } from './webview-host'
import { nativeBudget, type NativeBudget, type HostSpawn } from './native-helper'
import { shellBridge, parsePickRequest } from './shell-bridge'
import { launcherFailureFacts } from './failure'
import type { StartupBudget } from './startup'
import { appBundle } from './bundle'
import { developmentNativeHost } from '../shared/native-path'

export function nativeHostBinary(root: string) {
  return appBundle()?.nativeHost ?? developmentNativeHost(path.join(root, 'apps', 'desktop'))
}
export async function launchWebview(options: {
  binary: string
  url: string
  stateHome: string
  signal?: AbortSignal
  budget: NativeBudget
  startup: StartupBudget
  platform?: NodeJS.Platform
  vibrancy?: boolean
  initialScript?: string
  spawn?: HostSpawn
  onMessage?(body: unknown): void
  onOpen(context: Record<string, unknown>): void
}) {
  const platform = options.platform ?? process.platform
  const vibrancy = platform === 'darwin' && options.vibrancy === true
  const dataDir = path.resolve(options.stateHome, 'desktop', 'webview')
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-webview-'))
  const script = path.join(directory, 'init.js')
  const token = randomUUID()
  writeFileSync(
    script,
    (options.initialScript ?? '') +
      '\n' +
      shellBridge(
        options.url,
        platform === 'darwin' ? 'wkwebview' : 'webkitgtk',
        token,
        platform,
        vibrancy,
      ),
    { mode: 0o600 },
  )
  let host: WebviewHost
  try {
    host = new WebviewHost({
      ...options,
      platform,
      vibrancy,
      dataDir,
      initScriptPath: script,
      recordOpen: options.onOpen,
      cleanupOwnedWindow: () => rmSync(directory, { recursive: true, force: true }),
      onEvent: (event) => {
        if (event.event === 'message') options.onMessage?.(event.body)
        if (event.event !== 'message' || !isRecord(event.body) || event.body.token !== token) return
        if (event.body.method === 'setWindowAppearance') {
          const { opacity, material } = event.body
          if (
            vibrancy &&
            event.body.origin === new URL(options.url).origin &&
            typeof opacity === 'number' &&
            Number.isFinite(opacity) &&
            opacity >= 0 &&
            opacity <= 100 &&
            (material === 'none' || material === 'frosted' || material === 'glass')
          )
            host.setWindowAppearance({ opacity, material })
          return
        }
        if (event.body.method === 'drag' && event.body.origin === new URL(options.url).origin) {
          host.drag()
          return
        }
        const request = parsePickRequest(event.body, new URL(options.url).origin)
        if (!request) return
        void completePick(request.id, request.documentId, host.pick(request.options), reply)
      },
    })
    const reply = (response: unknown) =>
      host.evaluate(
        `if (location.origin === ${JSON.stringify(new URL(options.url).origin)}) globalThis.__platformShellReply?.(${JSON.stringify(response)})`,
      )
    await host.ready
    return { kind: 'owned' as const, exited: host.exited, close: () => host.close(), host }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
function publicFailure(error: unknown) {
  const { error: message, code, why, fix } = launcherFailureFacts(error)
  return { message, code, why, fix }
}
export async function showStartFailure(
  error: unknown,
  options: {
    binary: string
    logDir?: string
    signal?: AbortSignal
    budget?: NativeBudget
    spawn?: HostSpawn
  },
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-message-'))
  try {
    const file = path.join(directory, 'message.txt')
    const failure = publicFailure(error)
    const logs = options.logDir ? `\n\nLauncher logs are in ${options.logDir}.` : ''
    writeFileSync(file, `${failure.message}\n\n${failure.why}\n\n${failure.fix}${logs}`, {
      mode: 0o600,
    })
    await runNativeDialog({
      ...options,
      budget: options.budget ?? nativeBudget(),
      args: ['message', file],
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function completePick(
  id: number,
  documentId: string,
  pending: Promise<string[]>,
  reply: (response: unknown) => unknown,
) {
  try {
    const response = await pending.then(
      (paths) => ({ id, documentId, paths }),
      (error: unknown) => ({ id, documentId, error: publicFailure(error) }),
    )
    await reply(response)
  } catch {
    // A navigated or closed document has no remaining picker caller.
  }
}
