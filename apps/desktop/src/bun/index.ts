import { isNonEmptyString as isString } from '@workspace/utils/objects'
import { errorMessage } from '@workspace/contracts'
import { createDesktopError } from './structured-errors'

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import Electrobun, { BrowserView, BrowserWindow, Utils } from 'electrobun/main'
import { EvlogError } from 'evlog'
import type { SettingsValues } from '@workspace/contracts'
import { applyEnvFileOverrides } from '@workspace/observability/env-file'
import {
  allowedOriginsForWebPort,
  portFromEnv,
  runtimeUrl,
} from '../../../../scripts/runtime-network'
import type { DesktopRPC } from '../shared/rpc'
import type { PlatformPickOptions } from '../shared/bridge'
import {
  handoffPrelude,
  shellBackdrop,
  shellPlatform,
  windowTransparent,
  type ShellBackdrop,
  type WindowTransparency,
} from '../shared/window'
import { readSystemColorScheme } from './color-scheme'
import { preferPortalDialogs } from './gtk-portal'
import {
  flushDesktopObservability,
  initializeDesktopObservability,
  recordDesktopError,
  recordDesktopInfo,
  shouldInheritChildOutput,
} from './observability'
import { attachWindowVibrancy } from './vibrancy'
import { createQuitHandler } from './quit'
import {
  childLeaseFile,
  clearLease,
  leaseChild,
  releaseChild,
  stopLeftoverChildren,
} from './child-lease'
import { requireFreePort } from './ports'
import { groupAlive, signalGroup } from './processes'

type ChildProcess = ReturnType<typeof Bun.spawn>

const ROOT_DIR = resolvePlatformRoot()
applyEnvFileOverrides(path.join(ROOT_DIR, '.env'), Bun.env)
initializeDesktopObservability()
const WEB_DIR = path.join(ROOT_DIR, 'apps/web')
const MAIN_WINDOW_TITLE = 'Platform'
const TRANSPARENCY_KEY = 'window.transparency' satisfies keyof SettingsValues
const SHARED_DEV = Bun.env.PLATFORM_DESKTOP_SHARED_DEV === '1'
const PLATFORM = shellPlatform(process.platform)
const WEB_HOST = Bun.env.WEB_HOST ?? '127.0.0.1'
const WEB_PORT = portFromEnv(Bun.env, 'WEB_PORT', 5173)
const WEB_URL = runtimeUrl(WEB_HOST, WEB_PORT)
const SERVER_HOST = Bun.env.FS_HOST ?? '127.0.0.1'
const SERVER_PORT = portFromEnv(Bun.env, 'PORT', 3001)
const SERVER_URL = runtimeUrl(SERVER_HOST, SERVER_PORT)
const SERVER_PROBE_ORIGIN = WEB_URL
const SERVER_ALLOWED_ORIGINS = allowedOriginsForWebPort(
  Bun.env.SERVER_ALLOWED_ORIGINS,
  WEB_HOST,
  WEB_PORT,
)
const CHILD_LEASE = childLeaseFile(homedir(), ROOT_DIR)
const childProcesses = new Set<ChildProcess>()

let stopping: Promise<void> | null = null

Electrobun.events.on(
  'before-quit',
  createQuitHandler({
    cleanup: async () => {
      await stopProcesses()
      await flushDesktopObservability()
    },
    quit: Utils.quit,
    reportError: (error) =>
      recordDesktopError('desktop.stop_failed', { error: errorMessage(error) }),
  }),
)

try {
  await startDesktop()
} catch (error) {
  recordDesktopError('desktop.start_failed', startFailureContext(error))
  await stopProcesses()
  await flushDesktopObservability()
  await showStartFailure(error)
  Utils.quit()
}

async function startDesktop() {
  preferPortalDialogs(PLATFORM)
  if (SHARED_DEV) {
    await startSharedDesktop()
    return
  }

  await startStandaloneDesktop()
}

async function startSharedDesktop() {
  recordDesktopInfo('desktop.shared_dev.wait')
  await waitForHttp(`${SERVER_URL}/health`)
  await waitForHttp(WEB_URL)
  await openMainWindow()
}

async function startStandaloneDesktop() {
  await stopLeftoverChildren(CHILD_LEASE)
  await requireFreePort(SERVER_HOST, SERVER_PORT, 'server')
  await requireFreePort(WEB_HOST, WEB_PORT, 'web')
  await spawnServer()
  await spawnWeb()
  await waitForHttp(`${SERVER_URL}/health`)
  await waitForHttp(WEB_URL)
  await openMainWindow()
}

function spawnServer() {
  return spawnProcess(
    'server',
    [process.execPath, '--env-file=.env', 'apps/server/src/index.ts'],
    ROOT_DIR,
    {
      ...Bun.env,
      FS_HOST: SERVER_HOST,
      PORT: String(SERVER_PORT),
      SERVER_ALLOWED_ORIGINS,
    },
  )
}

function spawnWeb() {
  return spawnProcess(
    'web',
    [
      process.execPath,
      '--env-file=../../.env',
      'vite',
      '--host',
      WEB_HOST,
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    WEB_DIR,
    withNode22Path({
      ...Bun.env,
      VITE_SERVER_URL: SERVER_URL,
    }),
  )
}

async function openMainWindow() {
  const rpc = BrowserView.defineRPC<DesktopRPC>({
    maxRequestTime: 120_000,
    handlers: {
      requests: {
        pickEntry,
      },
    },
  })
  const backdrop = await resolveBackdrop()

  new BrowserWindow({
    title: MAIN_WINDOW_TITLE,
    frame: {
      height: 960,
      width: 1440,
      x: 0,
      y: 0,
    },
    preload: await preloadScript(backdrop),
    rpc,
    // Full-size app content with native macOS controls over our own toolbar.
    // Electrobun 2 applies the full offset; 6pt centers the controls in our 40px bar.
    trafficLightOffset: { x: 0, y: 6 },
    titleBarStyle: 'hiddenInset',
    transparent: windowTransparent(backdrop),
    url: WEB_URL,
  })

  // Pointless behind an opaque window: the view would be attached, and invisible.
  if (!windowTransparent(backdrop)) return

  void attachWindowVibrancy(MAIN_WINDOW_TITLE, ROOT_DIR)
}

/**
 * `preload` is JavaScript source, not a path — Electrobun hands the string
 * straight to the webview as its document-start script, so the `views://` URL
 * this used to pass parsed as a label plus a comment and silently did nothing.
 * That is why `window.platformBridge` never existed in the shell.
 */
async function preloadScript(backdrop: ShellBackdrop) {
  const bundlePath = path.join(import.meta.dirname, '..', 'views', 'preload', 'index.js')
  const bundle = Bun.file(bundlePath)
  if (!(await bundle.exists())) {
    recordDesktopError('desktop.preload.missing', { bundlePath })
    return null
  }

  const colorScheme = await readSystemColorScheme(PLATFORM)
  return handoffPrelude({ backdrop, platform: PLATFORM, colorScheme }) + (await bundle.text())
}

async function resolveBackdrop(): Promise<ShellBackdrop> {
  const transparency = await readWindowTransparency()
  const backdrop = shellBackdrop(process.platform, transparency)
  recordDesktopInfo('desktop.window.backdrop', {
    backdrop,
    platform: process.platform,
    transparency,
  })

  return backdrop
}

/**
 * Read from the running server rather than from the settings file, so the shell
 * and the page resolve one value through one resolver. An unreachable server
 * costs the opt-in, never the window.
 */
async function readWindowTransparency(): Promise<WindowTransparency> {
  try {
    const response = await fetch(`${SERVER_URL}/settings`, {
      headers: { Origin: SERVER_PROBE_ORIGIN },
    })
    if (!response.ok) return 'compositor'

    const snapshot = (await response.json()) as { values?: Partial<SettingsValues> }
    return snapshot.values?.[TRANSPARENCY_KEY] === 'window' ? 'window' : 'compositor'
  } catch (error) {
    recordDesktopError('desktop.settings.unreachable', { error: errorMessage(error) })
    return 'compositor'
  }
}

async function pickEntry(options: PlatformPickOptions) {
  const folder = startingFolder(options.startingPath)
  recordDesktopInfo('desktop.picker.open', {
    mode: options.mode,
    startingFolder: folder,
  })
  const paths = await openFileDialog(options, folder)

  const selectedPaths = paths.filter(Boolean)
  recordDesktopInfo('desktop.picker.selected', {
    count: selectedPaths.length,
    first: selectedPaths[0],
  })
  return { paths: selectedPaths }
}

async function openFileDialog(options: PlatformPickOptions, startingFolder: string) {
  try {
    return await Utils.openFileDialog({
      allowedFileTypes: allowedFileTypes(options.accept),
      allowsMultipleSelection: options.multiple === true,
      canChooseDirectory: options.mode === 'folder',
      canChooseFiles: options.mode === 'file',
      startingFolder,
    })
  } catch (error) {
    recordDesktopError('desktop.picker.failed', { error: errorMessage(error) })
    throw error
  }
}

async function spawnProcess(
  name: string,
  command: string[],
  cwd: string,
  env: Record<string, string | undefined>,
) {
  recordDesktopInfo('desktop.process.spawn', { command, cwd, name })
  const output = shouldInheritChildOutput() ? 'inherit' : 'ignore'
  // Its own process group, so one signal also reaches helpers such as Vite's node process.
  const child = Bun.spawn({
    cmd: command,
    cwd,
    detached: true,
    env,
    stderr: output,
    stdout: output,
  })

  childProcesses.add(child)
  void monitorProcess(name, child)
  await leaseChild(CHILD_LEASE, name, child.pid)
  return child
}

async function monitorProcess(name: string, child: ChildProcess) {
  const exitCode = await child.exited
  childProcesses.delete(child)
  // Helpers such as Vite's node process outlive their leader. A group id is not
  // reused while any member lives, so a live group here is still this child's.
  if (groupAlive(child.pid)) signalGroup(child.pid, 'SIGTERM')
  await releaseChild(CHILD_LEASE, child.pid).catch((error: unknown) =>
    recordDesktopError('desktop.lease.release_failed', { error: errorMessage(error), name }),
  )
  if (stopping) return

  recordDesktopError('desktop.process.exited', { exitCode, name })
  await stopProcesses()
  await flushDesktopObservability()
  Utils.quit()
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    if (await isHttpReady(url)) return

    await Bun.sleep(250)
  }

  throw createDesktopError(`Timed out waiting for ${url}`)
}

async function isHttpReady(url: string) {
  try {
    const response = await fetch(url, {
      headers: requestHeadersForProbe(url),
    })
    return response.ok
  } catch {
    return false
  }
}

function requestHeadersForProbe(url: string) {
  if (!url.startsWith(SERVER_URL)) return undefined

  return { Origin: SERVER_PROBE_ORIGIN }
}

function stopProcesses(): Promise<void> {
  if (stopping) return stopping
  const children = [...childProcesses]
  childProcesses.clear()

  for (const child of children) {
    signalGroup(child.pid, 'SIGTERM')
  }

  stopping = Promise.allSettled(children.map((child) => child.exited)).then(() =>
    clearLease(CHILD_LEASE),
  )
  return stopping
}

function startFailureContext(error: unknown) {
  if (!(error instanceof EvlogError)) return { error: errorMessage(error) }

  return { error: error.message, code: error.code, internal: error.internal }
}

/** Before the window exists, a dialog is the only place the user can read why. */
async function showStartFailure(error: unknown) {
  const fix = error instanceof EvlogError ? error.fix : undefined
  await Utils.showMessageBox({
    type: 'error',
    title: 'Platform could not start',
    message: errorMessage(error),
    detail: fix ?? '',
    buttons: ['Quit'],
  })
}

function allowedFileTypes(accept: readonly string[] | undefined) {
  if (!accept || accept.length === 0) return '*'

  const extensions = accept.map(allowedFileType).filter(Boolean)
  return extensions.length > 0 ? extensions.join(',') : '*'
}

function allowedFileType(token: string) {
  return token.trim().replace(/^\*\./, '').replace(/^\./, '')
}

function startingFolder(input: string | undefined) {
  if (!input) return Bun.env.HOME ?? '~/'
  if (path.isAbsolute(input)) return input

  return path.join(path.parse(ROOT_DIR).root, input)
}

function withNode22Path(env: Record<string, string | undefined>) {
  const nodeBin = latestNode22Bin()
  if (!nodeBin) return env

  return {
    ...env,
    PATH: pathWithPrefix(nodeBin, env.PATH),
  }
}

function latestNode22Bin() {
  const home = Bun.env.HOME
  if (!home) return null

  const versionsDir = path.join(home, '.nvm/versions/node')
  if (!existsSync(versionsDir)) return null

  const bins = readdirSync(versionsDir)
    .filter((entry) => entry.startsWith('v22.'))
    .map((entry) => path.join(versionsDir, entry, 'bin'))
    .filter((entry) => existsSync(entry))

  return bins.toSorted().at(-1) ?? null
}

function pathWithPrefix(prefix: string, current: string | undefined) {
  const entries = current?.split(path.delimiter).filter(Boolean) ?? []
  if (entries.includes(prefix)) return current

  return [prefix, ...entries].join(path.delimiter)
}

function resolvePlatformRoot() {
  const candidates = [
    Bun.env.PLATFORM_ROOT,
    Bun.env.INIT_CWD,
    Bun.env.PWD,
    import.meta.dirname,
    process.cwd(),
  ].filter(isString)

  for (const candidate of candidates) {
    const root = findPlatformRoot(candidate)
    if (root) return root
  }

  throw createDesktopError('Could not locate platform repository root.')
}

function findPlatformRoot(start: string) {
  let current = path.resolve(start)

  while (true) {
    if (isPlatformRoot(current)) return current

    const parent = path.dirname(current)
    if (parent === current) return null

    current = parent
  }
}

function isPlatformRoot(candidate: string) {
  return (
    existsSync(path.join(candidate, 'package.json')) &&
    existsSync(path.join(candidate, 'apps/server/src/index.ts')) &&
    existsSync(path.join(candidate, 'apps/web/package.json'))
  )
}
