import { mkdirSync } from 'node:fs'
import type { BrowserCandidate } from './browser'
import { CdpClient, cdpPipe } from './cdp'
import { browserProfile, chromiumArguments } from './profile'
import { singletonState } from './singleton'
import { acquireProfileLock } from './profile-lock'
import { installedIdentity, ensureInstalledApp } from './installed-app'
import { controllerAppUrls } from './controller-apps'
import {
  forgetVerifiedInstall,
  hasVerifiedInstall,
  installReceipt,
  rememberVerifiedInstall,
} from './install-receipt'
import { launcherErrors } from './structured-errors'
import {
  browserDiagnostics,
  browserProcessFacts,
  drainBrowserDiagnostics,
  startupProcessCounters,
} from './diagnostics'
import { startupSupervisor, type StartupBudget, type StartupCounters } from './startup'

type ChromiumOptions = {
  candidate: BrowserCandidate
  stateHome: string
  home: string
  url: string
  manifest?: string
  startup: StartupBudget
  // Tests replace the /proc sampler to drive progress deterministically.
  observe?: (pid: number) => StartupCounters
  signal?: AbortSignal
  onOpen(context: Record<string, unknown>): void
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
  const cap = startupSupervisor(options.startup, () => performance.now())
  const release = await acquireProfileLock({
    profile,
    remainingMs: cap.remainingMs,
    pollMs: Math.min(options.startup.idleMs, options.startup.limitMs) / 20,
    signal: options.signal,
  })
  try {
    const owner = await singletonState(profile, cap.remainingMs(), options.signal)
    if (owner === 'unverified')
      throw launcherErrors.PROFILE_BUSY({ internal: { reason: 'unverified-profile-owner' } })
    if (cap.remainingMs() <= 0)
      throw launcherErrors.PROFILE_BUSY({ internal: { reason: 'launcher-lock-limit' } })
    const remaining = { ...options, startup: { ...options.startup, limitMs: cap.remainingMs() } }
    if (owner === 'live') return await launchInstalledBrowser(remaining, profile, true)
    const receipt = installReceipt(options.url, options.manifest)
    if (hasVerifiedInstall(profile, receipt)) {
      try {
        const result = await launchInstalledBrowser(remaining, profile, false)
        options.onOpen({ engine: 'chromium', installed: true, installation: 'receipt' })
        return result
      } catch (error) {
        options.signal?.throwIfAborted()
        if ((error as { code?: string }).code !== 'desktop.launcher.LAUNCH_FAILED') throw error
        forgetVerifiedInstall(profile)
        const after = await singletonState(profile, cap.remainingMs(), options.signal)
        if (after !== 'idle' || cap.remainingMs() <= 0) throw error
      }
    }
    return await installAndLaunch(
      { ...remaining, startup: { ...remaining.startup, limitMs: cap.remainingMs() } },
      profile,
    )
  } finally {
    release()
  }
}

async function installAndLaunch(
  options: ChromiumOptions,
  profile: string,
): Promise<ChromiumWindow> {
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
    const urls = await controllerAppUrls(startupCdp, options.url)
    rememberVerifiedInstall(profile, installReceipt(options.url, options.manifest))
    startupPhase = 'controller-exit'
    cdp.close()
    const exitCode = await waitForBrowserExit(child, supervisor.remainingMs())
    if (exitCode === undefined) throw startupFailure('controller-exit-limit')
    clearInterval(startupMonitor)
    options.signal?.removeEventListener('abort', abort)
    let running =
      (await singletonState(profile, supervisor.remainingMs(), options.signal)) === 'live'
    for (const url of urls) {
      await launchInstalledBrowser(
        {
          ...options,
          url,
          startup: { idleMs: options.startup.idleMs, limitMs: supervisor.remainingMs() },
        },
        profile,
        running,
      )
      running = true
      handedOff = true
    }
    options.onOpen({ engine: 'chromium', installed: true, product: first.version.product })
    return { kind: 'handoff' }
  } catch (error) {
    if (!handedOff) await close()
    options.signal?.throwIfAborted()
    const internal = (error as { internal?: { reason?: string } }).internal
    const lostSingleton =
      internal?.reason === 'eof' || (startupPhase === 'version' && child.exitCode === 0)
    if (
      !handedOff &&
      lostSingleton &&
      (await singletonState(profile, supervisor.remainingMs(), options.signal)) === 'live'
    ) {
      const result = await launchInstalledBrowser(
        { ...options, startup: { ...options.startup, limitMs: supervisor.remainingMs() } },
        profile,
        true,
      )
      options.onOpen({ engine: 'chromium', installed: true, installation: 'singleton-handoff' })
      return result
    }
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
  try {
    while (child.exitCode === null) {
      options.signal?.throwIfAborted()
      if (
        !running &&
        (await singletonState(profile, supervisor.remainingMs(), options.signal)) === 'live'
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
    if (
      code !== 0 ||
      (await singletonState(profile, supervisor.remainingMs(), options.signal)) !== 'live'
    )
      throw launcherErrors.LAUNCH_FAILED({
        internal: { reason: 'installed-handoff', exitCode: code },
      })
    return { kind: 'handoff' }
  } catch (error) {
    await stopBrowserProcess(child)
    throw error
  }
}

async function stopOwnedBrowser(cdp: CdpClient, child: ReturnType<typeof Bun.spawn>) {
  cdp.close()
  await stopBrowserProcess(child)
}

async function stopBrowserProcess(child: ReturnType<typeof Bun.spawn>) {
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
