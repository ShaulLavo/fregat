import { mkdirSync } from 'node:fs'
import type { BrowserCandidate } from './browser'
import { CdpClient, cdpPipe } from './cdp'
import {
  browserProfile,
  browserProfileBusy,
  browserProfileOwner,
  chromiumArguments,
} from './profile'
import { liveSingletonOwner } from './singleton'
import { installedIdentity, ensureInstalledApp } from './installed-app'
import { launcherErrors } from './structured-errors'
import {
  browserDiagnostics,
  browserProcessFacts,
  drainBrowserDiagnostics,
  startupProcessCounters,
} from './diagnostics'
import { startupSupervisor, type StartupBudget, type StartupCounters } from './startup'
import type { NativeBudget } from './native-helper'

type ChromiumOptions = {
  candidate: BrowserCandidate
  stateHome: string
  home: string
  url: string
  native?: { binary: string; budget: NativeBudget }
  startup: StartupBudget
  // Tests replace the /proc sampler to drive progress deterministically.
  observe?: (pid: number) => StartupCounters
  signal?: AbortSignal
  onOpen(context: Record<string, unknown>): void
  onFailure(error: unknown): void
  onExit?(context: { exitCode: number; signal: string | null }): void
}
export type ChromiumWindow = { kind: 'handoff' }

export function assertChromiumVersion(product: unknown) {
  const major = typeof product === 'string' ? /^Chrome\/(\d+)\./.exec(product)?.[1] : undefined
  if (major && Number(major) >= 126) return
  throw launcherErrors.VERSION_UNSUPPORTED({
    internal: { reportedMajor: major ? Number(major) : null, requiredMajor: 126 },
  })
}

export async function launchChromium(options: ChromiumOptions): Promise<ChromiumWindow> {
  const profile = browserProfile(options.candidate, options.stateHome, options.home)
  mkdirSync(profile, { recursive: true })
  if (browserProfileBusy(profile)) return launchInstalledBrowser(options, profile, true)
  const supervisor = startupSupervisor(options.startup, () => performance.now())
  const child = Bun.spawn({
    cmd: [options.candidate.executable, ...chromiumArguments(options.candidate, profile)],
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
  })
  const spawnMs = Math.round(supervisor.elapsedMs())
  const diagnostics = browserDiagnostics()
  void drainBrowserDiagnostics(child.stderr as ReadableStream<Uint8Array>, diagnostics).catch(
    () => {},
  )
  let startupPhase = 'version'
  const cdp = cdpPipe(child.stdio[3] as number, child.stdio[4] as number)
  let closing: Promise<void> | undefined
  let handedOff = false
  const startupFailure = (reason: string) =>
    launcherErrors.CDP_FAILED({
      internal: {
        reason,
        startupPhase,
        startupObservation: process.platform === 'linux' ? 'process-and-cdp' : 'cdp-only',
        spawnMs,
        waitedMs: Math.round(supervisor.elapsedMs()),
        ...diagnostics.snapshot(),
        transport: cdp.snapshot(),
        ...browserProcessFacts(child.pid, options.candidate.executable, [
          child.stdio[3] as number,
          child.stdio[4] as number,
        ]),
      },
    })
  // Every setup request shares the startup cap. The installed browser keeps no runtime connection.
  const startupCdp: Pick<CdpClient, 'request'> = {
    request: (method, params, sessionId) => {
      return cdp
        .request(method, params, sessionId, supervisor.remainingMs())
        .catch((error: unknown) => {
          const reason = (error as { internal?: { reason?: unknown } }).internal?.reason
          throw reason === 'timeout' ? startupFailure('startup-limit') : error
        })
    },
  }
  const observe = options.observe ?? ((pid: number) => startupProcessCounters(pid))
  const startupMonitor = setInterval(
    () => {
      const verdict = supervisor.check({
        ...observe(child.pid),
        cdpReadBytes: cdp.snapshot().readBytes,
      })
      if (verdict === 'progressing') return
      clearInterval(startupMonitor)
      cdp.close(startupFailure(verdict))
    },
    // Sampling resolution, a twentieth of the shorter bound.
    Math.min(options.startup.idleMs, options.startup.limitMs) / 20,
  )
  const close = () => (closing ??= stopOwnedBrowser(cdp, child))
  const abort = () => {
    void close()
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    options.signal?.throwIfAborted()
    const startup = startupCdp.request('Browser.getVersion')
    const first = await Promise.race([
      startup.then((version) => ({ kind: 'version' as const, version })),
      child.exited.then((code) => ({ kind: 'exit' as const, code })),
    ])
    if (first.kind === 'exit') {
      cdp.close()
      options.signal?.throwIfAborted()
      throw launcherErrors.LAUNCH_FAILED({
        internal: { exitCode: first.code, startupPhase, ...diagnostics.snapshot() },
      })
    }
    startupPhase = 'installation'
    assertChromiumVersion(first.version.product)
    await ensureInstalledApp(startupCdp, options.url)
    startupPhase = 'controller-exit'
    cdp.close()
    const exitCode = await waitForBrowserExit(child, supervisor.remainingMs())
    if (exitCode === undefined) throw startupFailure('controller-exit-limit')
    clearInterval(startupMonitor)
    options.signal?.removeEventListener('abort', abort)
    const result = await launchInstalledBrowser(
      {
        ...options,
        startup: { idleMs: options.startup.idleMs, limitMs: supervisor.remainingMs() },
      },
      profile,
      false,
    )
    handedOff = true
    options.onOpen({ engine: 'chromium', installed: true, product: first.version.product })
    return result
  } catch (error) {
    if (!handedOff) await close()
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
    clearInterval(startupMonitor)
  }
}

async function launchInstalledBrowser(
  options: ChromiumOptions,
  profile: string,
  running: boolean,
): Promise<ChromiumWindow> {
  if (
    running &&
    !liveSingletonOwner(profile, options.candidate.executable) &&
    !browserProfileOwner(profile, options.candidate.executable)
  )
    throw launcherErrors.PROFILE_BUSY({ internal: { reason: 'unverified-profile-owner' } })
  options.signal?.throwIfAborted()
  const child = Bun.spawn({
    cmd: [
      options.candidate.executable,
      ...chromiumArguments(options.candidate, profile, {
        ...installedIdentity(options.url),
        url: options.url,
      }),
    ],
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  const supervisor = startupSupervisor(options.startup, () => performance.now())
  const observe = options.observe ?? startupProcessCounters
  while (child.exitCode === null) {
    if (
      (!running && browserProfileBusy(profile)) ||
      browserProfileOwner(profile, options.candidate.executable, child.pid)
    ) {
      child.unref()
      return { kind: 'handoff' }
    }
    const verdict = supervisor.check(observe(child.pid))
    if (verdict !== 'progressing') {
      child.kill('SIGTERM')
      await waitForBrowserExit(child, 2000)
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
      throw launcherErrors.LAUNCH_FAILED({
        internal: { reason: verdict, startupPhase: 'installed-window' },
      })
    }
    await Bun.sleep(Math.min(options.startup.idleMs, options.startup.limitMs) / 20)
  }
  const code = await child.exited
  if (code !== 0 || !browserProfileBusy(profile))
    throw launcherErrors.LAUNCH_FAILED({
      internal: { reason: 'installed-handoff', exitCode: code },
    })
  return { kind: 'handoff' }
}

async function stopOwnedBrowser(cdp: CdpClient, child: ReturnType<typeof Bun.spawn>) {
  cdp.close()
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await waitForBrowserExit(child, 2000)
  if (child.exitCode !== null) return
  child.kill('SIGKILL')
  await child.exited
}

async function waitForBrowserExit(child: ReturnType<typeof Bun.spawn>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      child.exited,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
