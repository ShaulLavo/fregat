import { mkdirSync } from 'node:fs'
import type { BrowserCandidate } from './browser'
import { CdpClient, cdpPipe, type CdpEvent } from './cdp'
import { isRecord } from '@workspace/utils/objects'
import { browserProfile, chromiumArguments } from './profile'
import { liveSingletonOwner } from './singleton'
import { launcherErrors } from './structured-errors'
import {
  browserDiagnostics,
  browserProcessFacts,
  drainBrowserDiagnostics,
  processCounters,
} from './diagnostics'
import { startupSupervisor, type StartupBudget, type StartupCounters } from './startup'
import type { PlatformBridge } from '../shared/bridge'

type ChromiumOptions = {
  candidate: BrowserCandidate
  stateHome: string
  home: string
  url: string
  startup: StartupBudget
  // Tests replace the /proc sampler to drive progress deterministically.
  observe?: (pid: number) => StartupCounters
  signal?: AbortSignal
  onOpen(context: Record<string, unknown>): void
  onFailure(error: unknown): void
  onExit?(context: { exitCode: number; signal: string | null }): void
}
export type ChromiumWindow =
  | { kind: 'handoff' }
  | { kind: 'owned'; cdp: CdpClient; exited: Promise<number>; close(): Promise<void> }

export function assertChromiumVersion(product: unknown) {
  const major = typeof product === 'string' ? /^Chrome\/(\d+)\./.exec(product)?.[1] : undefined
  if (major && Number(major) >= 126) return
  throw launcherErrors.VERSION_UNSUPPORTED({
    internal: { reportedMajor: major ? Number(major) : null, requiredMajor: 126 },
  })
}

export function chromiumBridge(url: string): string {
  const bridge: PlatformBridge = {
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
  }
  return `(() => {
    if (location.origin !== ${JSON.stringify(new URL(url).origin)} || window !== window.top) return;
    globalThis.__platformShell = ${JSON.stringify(bridge)};
    globalThis.platformBridge = ${JSON.stringify(bridge)};
    if (globalThis.__platformFrameCounter) return;
    globalThis.__platformFrameCounter = true;
    const measure = () => setTimeout(() => {
      let frames = 0;
      let active = true;
      const frame = () => { if (!active) return; frames++; requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
      setTimeout(() => {
        active = false;
        globalThis.platformShellCall(JSON.stringify({ rafPerSecond: frames, origin: location.origin }));
      }, 1000);
    }, 2000);
    if (document.readyState === 'complete') measure();
    else addEventListener('load', measure, { once: true });
  })()`
}

export async function attachChromium(
  cdp: Pick<CdpClient, 'request' | 'on'>,
  url: string,
  onOpen: (context: Record<string, unknown>) => void,
  onFailure: (error: unknown) => void,
) {
  const script = chromiumBridge(url)
  const sessions = new Set<string>()
  const contexts = new Map<string, Set<number>>()
  const origin = new URL(url).origin
  const preparing = new Set<Promise<void>>()
  const initialErrors: unknown[] = []
  let attaching = true
  const fail = (error: unknown) => {
    if (attaching) initialErrors.push(error)
    else onFailure(error)
  }
  cdp.on('Target.detachedFromTarget', (event) => {
    const session = event.params.sessionId
    if (typeof session !== 'string') return
    sessions.delete(session)
    contexts.delete(session)
  })
  cdp.on('Runtime.executionContextCreated', (event) => {
    const context = event.params.context
    if (!event.sessionId || !isRecord(context) || typeof context.id !== 'number') return
    if (
      context.origin !== origin ||
      !isRecord(context.auxData) ||
      context.auxData.isDefault !== true
    )
      return
    const ids = contexts.get(event.sessionId) ?? new Set<number>()
    ids.add(context.id)
    contexts.set(event.sessionId, ids)
  })
  cdp.on('Runtime.executionContextDestroyed', (event) => {
    if (event.sessionId && typeof event.params.executionContextId === 'number')
      contexts.get(event.sessionId)?.delete(event.params.executionContextId)
  })
  cdp.on('Runtime.executionContextsCleared', (event) => {
    if (event.sessionId) contexts.delete(event.sessionId)
  })
  cdp.on('Target.attachedToTarget', (event) => {
    const session = event.params.sessionId
    const target = event.params.targetInfo
    if (typeof session !== 'string' || !isRecord(target)) {
      fail(launcherErrors.CDP_FAILED({ internal: { reason: 'invalid-attachment' } }))
      return
    }
    if (sessions.has(session)) return
    sessions.add(session)
    const preparation = preparePage(cdp, session, target.type, script, origin)
      .catch((error: unknown) => {
        if (sessions.has(session)) fail(error)
      })
      .finally(() => preparing.delete(preparation))
    preparing.add(preparation)
  })
  cdp.on('Runtime.bindingCalled', (event) =>
    reportFrames(event, sessions, contexts, origin, onOpen),
  )
  await cdp.request('Target.setDiscoverTargets', { discover: true })
  await cdp.request('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  })
  // Auto-attach acknowledges before its page commands finish; keep startup supervision until they settle.
  while (preparing.size) await Promise.all(preparing)
  if (initialErrors.length) throw initialErrors[0]
  attaching = false
}

async function preparePage(
  cdp: Pick<CdpClient, 'request'>,
  session: string,
  type: unknown,
  script: string,
  origin: string,
) {
  if (type !== 'page') {
    await cdp.request('Runtime.runIfWaitingForDebugger', {}, session)
    return
  }
  await cdp.request('Page.enable', {}, session)
  await cdp.request('Runtime.enable', {}, session)
  await cdp.request('Runtime.addBinding', { name: 'platformShellCall' }, session)
  await cdp.request('Page.addScriptToEvaluateOnNewDocument', { source: script }, session)
  await cdp.request('Runtime.evaluate', { expression: script }, session)
  await cdp.request('Browser.grantPermissions', {
    origin,
    permissions: ['clipboardReadWrite', 'notifications'],
  })
  await cdp.request('Runtime.runIfWaitingForDebugger', {}, session)
}

function reportFrames(
  event: CdpEvent,
  sessions: ReadonlySet<string>,
  contexts: ReadonlyMap<string, ReadonlySet<number>>,
  origin: string,
  onOpen: (context: Record<string, unknown>) => void,
) {
  if (
    !event.sessionId ||
    !sessions.has(event.sessionId) ||
    typeof event.params.executionContextId !== 'number' ||
    !contexts.get(event.sessionId)?.has(event.params.executionContextId) ||
    event.params.name !== 'platformShellCall' ||
    typeof event.params.payload !== 'string'
  )
    return
  let payload: unknown
  try {
    payload = JSON.parse(event.params.payload)
  } catch {
    return
  }
  if (
    !isRecord(payload) ||
    payload.origin !== origin ||
    typeof payload.rafPerSecond !== 'number' ||
    !Number.isFinite(payload.rafPerSecond) ||
    payload.rafPerSecond < 0
  )
    return
  onOpen({ engine: 'chromium', rafPerSecond: payload.rafPerSecond })
}

export async function launchChromium(options: ChromiumOptions): Promise<ChromiumWindow> {
  const profile = browserProfile(options.candidate, options.stateHome, options.home)
  mkdirSync(profile, { recursive: true })
  const supervisor = startupSupervisor(options.startup, () => performance.now())
  const child = Bun.spawn({
    cmd: [
      options.candidate.executable,
      ...chromiumArguments(options.candidate, profile, options.url),
    ],
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
  let connected = false
  let starting = true
  const startupFailure = (reason: string) =>
    launcherErrors.CDP_FAILED({
      internal: {
        reason,
        startupPhase,
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
  // Requests sent while starting time out exactly at the startup cap; later ones keep the client default.
  const startupCdp: Pick<CdpClient, 'request' | 'on'> = {
    on: (method, handler) => cdp.on(method, handler),
    request: (method, params, sessionId) => {
      if (!starting) return cdp.request(method, params, sessionId)
      return cdp
        .request(method, params, sessionId, supervisor.remainingMs())
        .catch((error: unknown) => {
          const reason = (error as { internal?: { reason?: unknown } }).internal?.reason
          throw reason === 'timeout' ? startupFailure('startup-limit') : error
        })
    },
  }
  const observe = options.observe ?? ((pid: number) => processCounters(pid))
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
  void child.exited.then((exitCode) => {
    options.signal?.removeEventListener('abort', abort)
    options.onExit?.({ exitCode, signal: child.signalCode })
  })
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
      if (first.code === 0 && liveSingletonOwner(profile, options.candidate.executable))
        return { kind: 'handoff' }
      throw launcherErrors.LAUNCH_FAILED({
        internal: { exitCode: first.code, startupPhase, ...diagnostics.snapshot() },
      })
    }
    connected = true
    startupPhase = 'attach'
    assertChromiumVersion(first.version.product)
    await attachChromium(
      startupCdp,
      options.url,
      (context) => options.onOpen({ ...context, product: first.version.product }),
      (error) => {
        options.onFailure(error)
        void close()
      },
    )
    void cdp.done.then(() => close())
    return { kind: 'owned', cdp, exited: child.exited, close }
  } catch (error) {
    if (connected || options.signal?.aborted) {
      await close()
      throw error
    }
    // Singleton handoff can close the pipe just before the short-lived process exits.
    const code = await Promise.race([
      child.exited,
      Bun.sleep(Math.min(supervisor.idleRemainingMs(), supervisor.remainingMs())).then(
        () => undefined,
      ),
    ])
    if (
      !connected &&
      !options.signal?.aborted &&
      code === 0 &&
      liveSingletonOwner(profile, options.candidate.executable)
    ) {
      cdp.close()
      return { kind: 'handoff' }
    }
    await close()
    if (!connected && !options.signal?.aborted && code === 0) {
      throw launcherErrors.LAUNCH_FAILED({
        internal: { reason: 'unconfirmed-handoff', exitCode: code },
      })
    }
    throw error
  } finally {
    starting = false
    clearInterval(startupMonitor)
  }
}

async function stopOwnedBrowser(cdp: CdpClient, child: ReturnType<typeof Bun.spawn>) {
  cdp.close()
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([child.exited, Bun.sleep(2000)])
  if (child.exitCode !== null) return
  child.kill('SIGKILL')
  await child.exited
}
