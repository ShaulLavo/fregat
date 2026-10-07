import { defineConfig } from 'vitest/config'
import type { BrowserCommandContext } from 'vitest/node'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { BrowserContext } from 'playwright'
import type { HotPayload, Plugin, ViteDevServer } from 'vite'
import { stripVTControlCharacters } from 'node:util'
import { createScriptError } from '../../scripts/structured-errors.ts'
import { errorMessage } from '../../packages/contracts/src/error-fields'
import base from './vitest.browser.config.ts'
import {
  createRetentionReloadTransport,
  createRetentionReloadCases,
  createRetentionReloadTimings,
  archiveRetentionReloadFailure,
  archiveRetentionReloadArtifact,
  settleRetentionReloadCleanup,
  beginRetentionEntryCase,
  failRetentionEntryCase,
  endRetentionEntryCase,
  guardRetentionEntryObservation,
  observeRetentionEntryEvents,
  retentionEntryModulePath,
  retentionEntryErrorCode,
  retentionEntryReceiptTime,
  writeRetentionEntryReceipt,
  observeRetentionEntryForward,
  endRetentionEntryForward,
  type RetentionEntryPhase,
} from './test/factories/retention-acceptance-reload-transport'
import { createRetentionSocketProvenance } from './test/factories/retention-acceptance-socket-provenance'
import type {} from './test/factories/retention-acceptance-entry.tsx'

export default defineConfig(({ mode }) =>
  mode === 'retention-acceptance-entry'
    ? {
        ...base,
        root: import.meta.dirname,
        test: undefined,
        plugins: [...(base.plugins ?? []), retentionEntryReceiptPlugin()],
      }
    : {
        ...base,
        root: import.meta.dirname,
        test: {
          ...base.test,
          globalSetup: ['./test/env/retention-acceptance-file-server.ts'],
          provide: { retentionAcceptanceEntryUrl: 'http://127.0.0.1:52865' },
          include: ['src/features/editor/tests/retention-acceptance-reload.browser.tsx'],
          exclude: base.test?.exclude?.filter(
            (path) => path !== 'src/features/editor/tests/retention-acceptance-reload.browser.tsx',
          ),
          browser: {
            ...base.test?.browser,
            commands: {
              ...base.test?.browser?.commands,
              retentionAcceptanceReload,
              retentionAcceptanceReloadFinish,
            },
          },
        },
      },
)

type ReloadArm = {
  readonly syntax: 'colored' | 'plain'
  readonly font: 'normal' | 'slow'
  readonly saved: 'present' | 'absent'
}

const reloadCases = createRetentionReloadCases()

export type RetentionAcceptanceReloadCallerTiming = {
  readonly clock: 'browser'
  readonly state?: string
  readonly timedOut: boolean
  readonly marks: readonly {
    readonly stage: string
    readonly at: number
    readonly monotonicMs: number
  }[]
}

function retentionAcceptanceReloadFinish(
  context: BrowserCommandContext,
  operationId: string,
  callerTiming?: RetentionAcceptanceReloadCallerTiming,
) {
  if (callerTiming)
    guardRetentionEntryObservation(() =>
      console.info('RETENTION_CALLER_TIMING ' + JSON.stringify({ operationId, ...callerTiming })),
    )
  return reloadCases.finish(context, operationId)
}

function retentionAcceptanceReload(
  context: BrowserCommandContext,
  arm: ReloadArm,
  operationId: string,
) {
  return reloadCases.run(context, operationId, (signal) => {
    const browser = context.context.browser()
    if (!browser) throw createScriptError('Retention acceptance isolated browser is unavailable')
    const created = browser.newContext({
      colorScheme: 'dark',
      viewport: { width: 1200, height: 800 },
    })
    let disposed: Promise<void> | null = null
    let closed: Promise<void> | null = null
    const disposeRequests = () =>
      (disposed ??= created.then(
        (isolated) => isolated.request.dispose(),
        () => undefined,
      ))
    const closeContext = () =>
      (closed ??= created.then(
        (isolated) => isolated.close(),
        () => undefined,
      ))
    return {
      result: performRetentionAcceptanceReload(
        context,
        arm,
        created,
        signal,
        disposeRequests,
        closeContext,
        operationId,
      ),
      close: async () => {
        const results = await Promise.allSettled([disposeRequests(), closeContext()])
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length)
          throw createScriptError('Retention acceptance context cleanup failed', {
            internal: { count: failures.length },
          })
      },
    }
  })
}

async function performRetentionAcceptanceReload(
  context: BrowserCommandContext,
  arm: ReloadArm,
  created: Promise<BrowserContext>,
  signal: AbortSignal,
  disposeRequests: () => Promise<void>,
  closeContext: () => Promise<void>,
  operationId: string,
) {
  const timings = createRetentionReloadTimings()
  const controllerMarks: Record<string, number> = { startedAt: Date.now() }
  timings.controller = controllerMarks
  const isolated = await created
  controllerMarks.contextCreatedAt = Date.now()
  signal.throwIfAborted()
  const page = await isolated.newPage()
  signal.throwIfAborted()
  const runnerOrigin = new URL(context.page.url()).origin
  const entryOrigin = context.project.getProvidedContext().retentionAcceptanceEntryUrl
  await isolated.grantPermissions(['local-network-access'], { origin: runnerOrigin })
  controllerMarks.permissionsReadyAt = Date.now()
  let reloading = false
  const delayedFonts: { url: string; heldAt: number; releasedAt: number }[] = []
  const transport = createRetentionReloadTransport(
    {
      run: (observation, operation) =>
        observeRetentionEntryForward(entryOrigin, output, observation, operation),
      settled: (observation) => endRetentionEntryForward(entryOrigin, observation),
    },
    timings,
  )
  const stopTransport = () => {
    transport.stopAdmission()
    void transport.cancelPending()
  }
  signal.addEventListener('abort', stopTransport, { once: true })
  await page.route(
    (url) => url.origin === runnerOrigin,
    (route) => {
      return transport.run(
        route.request().url(),
        async (fulfill, headersCompleted, markHttp) => {
          const request = new URL(route.request().url())
          if (
            reloading &&
            arm.font === 'slow' &&
            request.pathname.includes('jetbrains-mono') &&
            request.pathname.endsWith('.woff2')
          ) {
            const heldAt = Date.now()
            await new Promise<void>((resolve) => setTimeout(resolve, 1000))
            delayedFonts.push({ url: request.href, heldAt, releasedAt: Date.now() })
          }
          markHttp('headersStartedAt')
          const headers =
            route.request().method() === 'GET'
              ? { ...(await route.request().allHeaders()), connection: 'close' }
              : undefined
          headersCompleted()
          signal.throwIfAborted()
          markHttp('fetchStartedAt')
          const response = await route.fetch({
            url: new URL(request.pathname + request.search, entryOrigin).href,
            headers,
          })
          markHttp('fetchCompletedAt')
          await fulfill(() => route.fulfill({ response }))
        },
        () => route.abort('failed'),
      )
    },
  )
  const output = await mkdtemp(join(tmpdir(), 'retention-acceptance-reload-'))
  controllerMarks.setupReadyAt = Date.now()
  beginRetentionEntryCase(entryOrigin, output, timings)
  const errors: string[] = []
  const pending = new Set<string>()
  const consoleMessages: { readonly type: string; readonly text: string }[] = []
  page.on('request', (request) => pending.add(request.url()))
  page.on('requestfinished', (request) => pending.delete(request.url()))
  const requestFailures: { url: string; at: number; error: string | null }[] = []
  page.on('requestfailed', (request) => {
    pending.delete(request.url())
    requestFailures.push({
      url: request.url(),
      at: Date.now(),
      error: request.failure()?.errorText ?? null,
    })
  })
  page.on('console', (message) =>
    consoleMessages.push({ type: message.type(), text: message.text() }),
  )
  const responses: { readonly url: string; readonly status: number }[] = []
  let phase: RetentionEntryPhase = 'entry'
  page.on('response', (response) =>
    responses.push({ url: response.url(), status: response.status() }),
  )
  page.on('pageerror', (error) => errors.push(error.message))
  const operation = (async () => {
    await page.goto(new URL('/test/factories/retention-acceptance-entry.html', runnerOrigin).href)
    phase = 'entry-owner'
    await page.waitForFunction(() => Boolean(window.__retentionAcceptanceEntry), undefined, {
      timeout: 15_000,
    })
    phase = 'fixture-open'
    await page.evaluate(async (syntax) => {
      const owner = window.__retentionAcceptanceEntry
      if (!owner) return
      await owner.setSyntaxEnabled(syntax === 'colored')
      await owner.openFixture()
    }, arm.syntax)
    phase = 'baseline-ready'
    await waitForRetentionAcceptanceEntry(page)
    timings.baselineReadyAt = Date.now()
    const before = await page.evaluate(() => window.__retentionAcceptanceEntry?.capture())
    await page.addInitScript((saved) => {
      const savedKeys = Object.keys(localStorage).filter((key) =>
        key.includes('editorVisibleSnapshot'),
      )
      const priorSavedRecords = savedKeys.map((key) => ({
        key,
        serialized: localStorage.getItem(key),
      }))
      if (saved === 'absent') for (const key of savedKeys) localStorage.removeItem(key)
      window.__retentionAcceptanceReloadCacheReceipt = {
        priorSavedKeys: savedKeys,
        priorSavedRecords,
        remainingSavedKeys: Object.keys(localStorage).filter((key) =>
          key.includes('editorVisibleSnapshot'),
        ),
      }
      const frames: ReloadFrame[] = []
      const readRow = (row: HTMLElement) => {
        const runs: ReloadRow['runs'][number][] = []
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        let offset = 0
        let text = walker.nextNode()
        while (text) {
          const content = text.textContent ?? ''
          const style = getComputedStyle(text.parentElement ?? row)
          runs.push({
            start: offset,
            end: offset + content.length,
            text: content,
            style: {
              color: style.color,
              backgroundColor: style.backgroundColor,
              textDecoration: style.textDecorationLine,
              textDecorationColor: style.textDecorationColor,
              textDecorationStyle: style.textDecorationStyle,
              textDecorationThickness: style.textDecorationThickness,
            },
          })
          offset += content.length
          text = walker.nextNode()
        }
        return {
          text: row.textContent,
          html: row.outerHTML,
          visible: row.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
          runs,
        }
      }
      Object.defineProperty(window, '__retentionAcceptanceReloadFrames', {
        value: frames,
        configurable: true,
      })
      const tick = () => {
        const input = document.querySelector<HTMLElement>('.editor-virtualized-input')
        const selectedTab = document.querySelector<HTMLElement>(
          '[data-editor-tab-id][aria-selected="true"]',
        )
        frames.push({
          at: performance.now(),
          editor: Boolean(document.querySelector('.editor-virtualized')),
          rows: [...document.querySelectorAll<HTMLElement>('.editor-virtualized-row')].map(readRow),
          fonts: {
            status: document.fonts.status,
            codeLoaded: document.fonts.check('13px "JetBrains Mono Variable"'),
          },
          input: {
            mounted: Boolean(input),
            readonly:
              input?.getAttribute('aria-readonly') === 'true' ||
              (input instanceof HTMLTextAreaElement && input.readOnly),
            disabled: input instanceof HTMLTextAreaElement && input.disabled,
          },
          header: {
            tabId: selectedTab?.dataset.editorTabId ?? null,
            groupId:
              selectedTab?.closest<HTMLElement>('[data-editor-group-id]')?.dataset.editorGroupId ??
              null,
            path: selectedTab?.dataset.editorTabPath ?? null,
            busy: selectedTab?.getAttribute('aria-busy') === 'true',
            loading: selectedTab?.dataset.editorTabLoading === 'true',
          },
          observation: window.__retentionAcceptanceEntry?.capture() ?? null,
        })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, arm.saved)
    phase = 'reload'
    reloading = true
    await page.reload()
    timings.reloadLoadedAt = Date.now()
    timings.browserTimeOrigin = await page.evaluate(() => performance.timeOrigin)
    await waitForRetentionAcceptanceEntry(page)
    timings.reloadReadyAt = Date.now()
    phase = 'code-font-loaded'
    const fontLoadReceipt = await page.evaluate(async () => {
      const font = '13px "JetBrains Mono Variable"'
      const faces = await document.fonts.load(font)
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return {
        faceCount: faces.length,
        families: faces.map((face) => face.family),
        status: document.fonts.status,
        codeLoaded:
          faces.length > 0 &&
          faces.every((face) => face.status === 'loaded') &&
          document.fonts.check(font),
      }
    })
    timings.fontReadyAt = Date.now()
    const after = await page.evaluate(() => window.__retentionAcceptanceEntry?.capture())
    const frames = await page.evaluate(() => window.__retentionAcceptanceReloadFrames)
    const cacheReceipt = await page.evaluate(() => window.__retentionAcceptanceReloadCacheReceipt)
    const screenshot = join(output, 'page.png')
    await page.screenshot({ path: screenshot, fullPage: true })
    timings.screenshotCompleteAt = Date.now()
    const result = {
      arm,
      before,
      after,
      frames,
      cacheReceipt,
      delayedFonts,
      timings,
      fontLoadReceipt,
      setup: {
        entryOrigin,
        runnerOrigin,
        permission: 'local-network-access',
        permissionOrigin: runnerOrigin,
      },
      errors,
      responses,
      requestFailures,
      output,
      screenshot,
    }
    if (transport.hasFailure) throw transport.firstError
    controllerMarks.operationResultReadyAt = Date.now()
    await writeFile(join(output, 'raw.json'), JSON.stringify(result))
    return result
  })()
  const artifactFailures: unknown[] = []
  let cleanupFailures: unknown[] = []
  let forwardContextDisposal: Promise<void> | null = null
  let forwardContextDisposed = false
  let contextClosedAsFallback = false
  const outcome = await transport
    .race(operation)
    .then(
      (result) => ({ kind: 'success' as const, result }),
      async (error: unknown) => {
        failRetentionEntryCase(entryOrigin, output, phase, transport.failures)
        const frames = await page
          .evaluate(() => window.__retentionAcceptanceReloadFrames)
          .catch(() => null)
        const setup = await page
          .evaluate(() => ({
            bootstrap: window.__retentionAcceptanceBootstrap?.() ?? null,
            owner: Boolean(window.__retentionAcceptanceEntry),
            observation: window.__retentionAcceptanceEntry?.capture() ?? null,
            dom: document.body.innerHTML,
          }))
          .catch(() => null)
        await page
          .screenshot({ path: join(output, 'failure.png'), fullPage: true })
          .catch(() => undefined)
        artifactFailures.push(
          ...(await archiveRetentionReloadFailure(output, {
            arm,
            timings,
            phase,
            pending: [...pending],
            consoleMessages,
            setup,
            responses,
            requestFailures,
            frames,
            errors,
            failure: error instanceof Error ? error.message : String(error),
            transportFailures: transport.failures,
            transportRequests: transport.requests,
          })),
        )
        return { kind: 'failure' as const, error }
      },
    )
    .finally(async () => {
      const cleanup = await settleRetentionReloadCleanup(
        [
          {
            stage: 'restore-syntax',
            run: async () => {
              if (signal.aborted) return
              transport.beginRestoration()
              await page.evaluate(() => window.__retentionAcceptanceEntry?.setSyntaxEnabled(true))
            },
          },
          {
            stage: 'stop-forward-admission',
            run: async () => {
              transport.stopAdmission()
            },
          },
          {
            stage: 'archive-final-frames',
            run: async () => {
              artifactFailures.push(
                ...(await archiveFinalRetentionReloadFrames(page, output, {
                  phase,
                  timings,
                  transportFailures: transport.failures,
                  transportRequests: transport.requests,
                  requestFailures,
                })),
              )
            },
          },
          {
            stage: 'cancel-forwarding',
            run: async () => {
              await transport.cancelPending()
            },
          },
          {
            stage: 'dispose-forward-context',
            run: async () => {
              forwardContextDisposal = disposeRequests().then(() => {
                forwardContextDisposed = true
              })
              void forwardContextDisposal.catch(() => {})
            },
          },
          {
            stage: 'fallback-context-close',
            run: async () => {
              if (forwardContextDisposed && !transport.needsContextClose) return
              await closeContext()
              contextClosedAsFallback = true
            },
          },
          {
            stage: 'join-forward-context-disposal',
            run: async () => {
              await forwardContextDisposal
            },
          },
          { stage: 'drain-routes', run: () => transport.drain() },
          {
            stage: 'unroute',
            run: async () => {
              if (!contextClosedAsFallback) await page.unrouteAll({ behavior: 'default' })
            },
          },
          { stage: 'close-context', run: closeContext },
        ],
        operation,
      )
      controllerMarks.cleanupReadyAt = Date.now()
      artifactFailures.push(
        ...(await archiveRetentionReloadArtifact(output, 'cleanup.json', {
          phase,
          timings,
          requestFailures,
          transportFailures: transport.failures,
          transportRequests: transport.requests,
          artifactFailures: artifactFailures.map(errorMessage),
          cleanup: cleanup.map((outcome) => ({
            ...outcome,
            error: outcome.error === null ? null : errorMessage(outcome.error),
          })),
        })),
      )
      cleanupFailures = cleanup
        .filter((result) => result.error !== null)
        .map((result) => result.error)
    })
  if (outcome.kind === 'failure') {
    signal.removeEventListener('abort', stopTransport)
    endRetentionEntryCase(entryOrigin, output)
    throw outcome.error
  }
  if (transport.hasFailure || cleanupFailures.length > 0 || artifactFailures.length > 0)
    failRetentionEntryCase(entryOrigin, output, phase, transport.failures)
  endRetentionEntryCase(entryOrigin, output)
  signal.removeEventListener('abort', stopTransport)
  if (transport.hasFailure) throw transport.firstError
  if (cleanupFailures.length > 0) throw cleanupFailures[0]
  if (artifactFailures.length > 0) throw artifactFailures[0]
  controllerMarks.returnReadyAt = Date.now()
  guardRetentionEntryObservation(() =>
    console.info(
      'RETENTION_CONTROLLER_TIMING ' +
        JSON.stringify({ operationId, arm, clock: 'node', marks: controllerMarks }),
    ),
  )
  return outcome.result
}

async function archiveFinalRetentionReloadFrames(
  page: BrowserCommandContext['page'],
  output: string,
  facts: Record<string, unknown>,
) {
  const final = await page
    .evaluate(() => ({
      frames: window.__retentionAcceptanceReloadFrames ?? null,
      observation: window.__retentionAcceptanceEntry?.capture() ?? null,
    }))
    .catch((error: unknown) => ({ failure: errorMessage(error) }))
  return archiveRetentionReloadArtifact(output, 'final-raw.json', { ...facts, final })
}

function waitForRetentionAcceptanceEntry(page: BrowserCommandContext['page']) {
  return page.waitForFunction(
    () => {
      const observation = window.__retentionAcceptanceEntry?.capture()
      return (
        observation?.kind === 'mounted' &&
        observation.views.some((view) => view.kind === 'observed' && view.mismatch === null)
      )
    },
    undefined,
    { timeout: 15_000 },
  )
}

declare global {
  interface Window {
    __retentionAcceptanceReloadFrames?: readonly ReloadFrame[]
    __retentionAcceptanceReloadCacheReceipt?: {
      readonly priorSavedKeys: readonly string[]
      readonly remainingSavedKeys: readonly string[]
      readonly priorSavedRecords: readonly {
        readonly key: string
        readonly serialized: string | null
      }[]
    }
  }
}

type ReloadFrame = {
  readonly at: number
  readonly editor: boolean
  readonly rows: readonly ReloadRow[]
  readonly fonts: { readonly status: string; readonly codeLoaded: boolean }
  readonly input: {
    readonly mounted: boolean
    readonly readonly: boolean
    readonly disabled: boolean
  }
  readonly header: {
    readonly tabId: string | null
    readonly groupId: string | null
    readonly path: string | null
    readonly busy: boolean
    readonly loading: boolean
  }
  readonly observation: ReturnType<
    NonNullable<Window['__retentionAcceptanceEntry']>['capture']
  > | null
}

type ReloadRow = {
  readonly text: string | null
  readonly html: string
  readonly visible: boolean
  readonly runs: readonly {
    readonly start: number
    readonly end: number
    readonly text: string
    readonly style: Record<string, string>
  }[]
}

export type RetentionAcceptanceReloadResult = Awaited<ReturnType<typeof retentionAcceptanceReload>>

declare module 'vitest' {
  interface ProvidedContext {
    retentionAcceptanceEntryUrl: string
  }
}

function retentionEntryReceiptPlugin(): Plugin {
  return {
    name: 'retention-entry-receipt',
    configureServer(server) {
      guardRetentionEntryObservation(() => installRetentionEntryReceipt(server))
    },
  }
}

function installRetentionEntryReceipt(server: ViteDevServer) {
  const http = server.httpServer
  if (
    !http ||
    !('keepAliveTimeout' in http) ||
    !('headersTimeout' in http) ||
    !('requestTimeout' in http) ||
    !('maxRequestsPerSocket' in http)
  )
    return
  const note = (event: object) =>
    writeRetentionEntryReceipt({ ...retentionEntryReceiptTime(), ...event })
  const journal = createRetentionSocketProvenance({
    side: 'serving',
    entryPort: server.config.server.port ?? 0,
    normalizePath: (path) => retentionEntryModulePath(join(import.meta.dirname, '../..'), path),
    server: http,
  })
  note({ kind: 'socket-journal', basename: journal.basename })
  let requestId = 0
  let socketId = 0
  const sockets = new WeakMap<Socket, number>()
  const observeSocket = (socket: Socket) => {
    const existing = sockets.get(socket)
    if (existing !== undefined) return existing
    const id = ++socketId
    sockets.set(socket, id)
    note({ kind: 'socket-open', socketId: id, port: socket.localPort ?? 0 })
    observeRetentionEntryEvents(socket, (event, args) => {
      if (event === 'end' || event === 'timeout' || event === 'close')
        note({ kind: 'socket-' + event, socketId: id })
      if (event === 'error')
        note({ kind: 'socket-error', socketId: id, code: retentionEntryErrorCode(args[0]) })
    })
    return id
  }
  const observeRequest = (request: IncomingMessage, response: ServerResponse) => {
    const id = ++requestId
    const connection = observeSocket(request.socket)
    const path = retentionEntryModulePath(join(import.meta.dirname, '../..'), request.url ?? '')
    if (!path) {
      note({ kind: 'refused', count: 1 })
      return
    }
    note({ kind: 'request', requestId: id, socketId: connection, path, method: request.method })
    observeRetentionEntryEvents(request, (event, args) => {
      if (event === 'aborted')
        note({ kind: 'request-aborted', requestId: id, socketId: connection })
      if (event === 'error')
        note({
          kind: 'request-error',
          requestId: id,
          socketId: connection,
          code: retentionEntryErrorCode(args[0]),
        })
    })
    observeRetentionEntryEvents(response, (event, args) => {
      if (event === 'finish' || event === 'close')
        note({
          kind: 'response-' + event,
          requestId: id,
          socketId: connection,
          path,
          status: response.statusCode,
          complete: response.writableFinished,
        })
      if (event === 'error')
        note({
          kind: 'response-error',
          requestId: id,
          socketId: connection,
          code: retentionEntryErrorCode(args[0]),
        })
    })
  }
  http.prependListener('connection', (socket: Socket) =>
    guardRetentionEntryObservation(() => {
      observeSocket(socket)
    }),
  )
  http.prependListener('request', (request: IncomingMessage, response: ServerResponse) =>
    guardRetentionEntryObservation(() => observeRequest(request, response)),
  )
  observeRetentionEntryEvents(http, (event, args) => {
    if (event === 'close') note({ kind: 'server-close' })
    if (event === 'error') note({ kind: 'server-error', code: retentionEntryErrorCode(args[0]) })
    if (event !== 'listening') return
    const address = http.address()
    if (address && typeof address !== 'string') note({ kind: 'listening', port: address.port })
  })
  note({
    kind: 'installed',
    port: server.config.server.port ?? 0,
    keepAliveTimeout: http.keepAliveTimeout,
    headersTimeout: http.headersTimeout,
    requestTimeout: http.requestTimeout,
    maxRequestsPerSocket: http.maxRequestsPerSocket,
  })
  observeRetentionEntryOptimizer(server, note)
}

function observeRetentionEntryOptimizer(server: ViteDevServer, note: (event: object) => void) {
  const logger = server.config.logger
  for (const method of ['info', 'error'] as const) {
    const original = logger[method]
    logger[method] = function (message, options) {
      guardRetentionEntryObservation(() => {
        const text = stripVTControlCharacters(message)
        if (text === '[optimizer] bundling dependencies...') note({ kind: 'optimizer-bundling' })
        if (/^dependenc(?:y|ies) optimized: /.test(text)) note({ kind: 'optimizer-optimized' })
        if (text === 'optimized dependencies changed. reloading') note({ kind: 'optimizer-reload' })
        if (text.startsWith('error while updating dependencies:\n'))
          note({ kind: 'optimizer-error' })
      })
      return Reflect.apply(original, this, [message, options])
    }
  }
  const send = server.ws.send
  server.ws.send = function (payload: HotPayload | string, ...rest: unknown[]) {
    guardRetentionEntryObservation(() => {
      if (typeof payload === 'object' && payload.type === 'full-reload')
        note({ kind: 'full-reload' })
    })
    return Reflect.apply(send, this, [payload, ...rest])
  }
}
