import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { HTML_BOOTSTRAP_WALLPAPER_IDS } from '../../packages/contracts/src/html-bootstrap'
import { rendererBackendLabel } from '../../apps/web/src/features/terminal/utils/renderer-backend'
import { startIsolatedServer, type IsolatedServer } from '../agent/isolated-server'
import {
  capturedTerminal,
  installCaptureTerminalNamespace,
  killCaptureTerminal,
  type CaptureTerminal,
} from '../agent/product-terminal'
import { runPaletteCommand, selectors } from '../agent/selectors'
import { attachObserver, observedProblems, serializable } from '../agent/observe.mjs'
import { createScriptError } from '../structured-errors'
import { openLiveBrowser } from './live-browser.mjs'
import {
  foreignTerminalRequests,
  terminalFailures,
  terminalReleaseFailures,
  waitForTerminalPrompt,
} from './live-terminal.mjs'
import { PROTOCOL_VERSION } from '../../apps/server/src/terminal-host/protocol'
import { withTerminalCheck } from './live-terminal-scope'

const prompt = 'fregat-live-check$'

async function checkLiveTerminal(target: URL, out: string, releaseRoot: string) {
  const prefix = `live-check-${crypto.randomUUID()}-`
  const sessions: CaptureTerminal[] = []
  const report = {
    count: 0,
    promptRendered: false,
    rendererBackend: null as string | null,
    closed: false,
    failures: [] as string[],
    sessions: [] as Awaited<ReturnType<typeof killCaptureTerminal>>[],
    coverage: {
      client: 'Deployed client rendering with an isolated backend built from the deployed commit.',
      server:
        'Fresh deployed terminal-host round-trip through read-only /terminal/health; host build is informational.',
      excluded:
        'Opening a terminal on the deployed server requires durable workspace and project registration.',
    },
    deployedRelease: undefined as Awaited<ReturnType<typeof readRelease>> | undefined,
    isolatedRelease: undefined as Awaited<ReturnType<typeof readRelease>> | undefined,
    foreignRequests: [] as string[],
  }
  let server: IsolatedServer | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let observed: ReturnType<typeof attachObserver> | undefined
  const requests: string[] = []
  await withTerminalCheck(
    tmpdir(),
    async (directory, signal) => {
      const webRoot = path.join(directory, 'web')
      const workspaceRoot = path.join(directory, 'workspace')
      signal.addEventListener(
        'abort',
        () => {
          void browser?.close().catch(() => {})
        },
        { once: true },
      )
      try {
        report.deployedRelease = await readRelease(new URL('release', target), signal)
        await mkdir(webRoot)
        await mkdir(workspaceRoot)
        const response = await fetch(target, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          redirect: 'error',
        })
        if (!response.ok) throw createScriptError(`Terminal document returned ${response.status}.`)
        const documentHeaders = Object.fromEntries(
          ['cross-origin-opener-policy', 'cross-origin-embedder-policy'].flatMap((key) => {
            const value = response.headers.get(key)
            return value ? [[key, value]] : []
          }),
        )
        // The served document has consumed these slots; the isolated renderer needs its own slots.
        const slots = Object.values(HTML_BOOTSTRAP_WALLPAPER_IDS)
        const template = await new HTMLRewriter()
          .on(slots.map((id) => `#${id}`).join(','), {
            element: (element) => {
              element.remove()
            },
          })
          .on('head', {
            element: (element) => {
              element.append(slots.map((id) => `<link id="${id}">`).join(''), { html: true })
            },
          })
          .transform(response)
          .text()
        await writeFile(path.join(webRoot, 'index.html'), template)
        const shell = Bun.which('sh')
        if (!shell) throw createScriptError('The terminal live check requires a POSIX shell.')
        process.env.HOME = directory
        process.env.SHELL = shell
        process.env.PS1 = `${prompt} `
        delete process.env.ENV
        delete process.env.BASH_ENV
        server = await startIsolatedServer(undefined, {
          webRoot,
          releaseRoot,
          handleSignals: false,
          settings: { 'terminal.integrated.screenReader': true },
        })
        signal.throwIfAborted()
        report.isolatedRelease = await readRelease(new URL('/release', server.origin), signal)
        if (report.isolatedRelease.server?.commit !== report.deployedRelease.commit)
          throw createScriptError('The isolated backend commit differs from the deployed client.')
        const live = await openLiveBrowser(chromium, process.platform, signal)
        browser = live.browser
        page = live.page
        signal.throwIfAborted()
        page.context().on('request', (request) => requests.push(request.url()))
        await page.context().grantPermissions(['local-network-access'], { origin: server.origin })
        observed = attachObserver(page, server.origin)
        const api = server.origin
        const basePath = target.pathname
        await page.context().route('**/*', async (route) => {
          const request = route.request()
          const url = new URL(request.url())
          if (foreignTerminalRequests([url.href], [api, target.origin]).length > 0)
            return route.abort('blockedbyclient')
          if (url.origin === target.origin && request.method() !== 'GET') {
            report.failures.push('terminal check: deployed server mutation was blocked')
            return route.abort('blockedbyclient')
          }
          if (url.origin !== api) return route.continue()
          const relative = url.pathname.startsWith(basePath)
            ? url.pathname.slice(basePath.length)
            : url.pathname.slice(1)
          if (
            relative.startsWith('assets/') ||
            ['script', 'stylesheet', 'font', 'image'].includes(request.resourceType())
          ) {
            requests.push(new URL(relative + url.search, target).href)
            const asset = await route.fetch({
              maxRedirects: 0,
              url: new URL(relative + url.search, target).href,
              method: 'GET',
              headers: { accept: request.headers().accept ?? '*/*', origin: target.origin },
            })
            return route.fulfill({ response: asset })
          }
          if (request.resourceType() === 'document') {
            const document = await route.fetch({
              url: `${api}/${relative}${url.search}`,
              maxRedirects: 0,
            })
            return route.fulfill({
              response: document,
              headers: { ...document.headers(), ...documentHeaders },
            })
          }
          if (basePath !== '/' && url.pathname.startsWith(basePath))
            return route.fulfill({
              response: await route.fetch({
                url: `${api}/${relative}${url.search}`,
                maxRedirects: 0,
              }),
            })
          return route.continue()
        })
        await page.addInitScript((basePath) => {
          const NativeSocket = window.WebSocket
          window.WebSocket = class extends NativeSocket {
            constructor(address: string | URL, protocols?: string | string[]) {
              const url = new URL(address, location.href)
              if (url.host !== location.host)
                throw new DOMException(
                  'Terminal sockets require the isolated API.',
                  'SecurityError',
                )
              if (
                url.host === location.host &&
                basePath !== '/' &&
                url.pathname.startsWith(basePath)
              )
                url.pathname = `/${url.pathname.slice(basePath.length)}`
              super(url, protocols)
            }
          }
        }, basePath)
        await installCaptureTerminalNamespace(page, prefix)
        page.on('websocket', (socket) => {
          requests.push(socket.url())
          const session = capturedTerminal(socket.url(), prefix)
          if (session) sessions.push(session)
        })
        const workspace = await page.request.post(`${api}/fs/workspace-address`, {
          data: { path: workspaceRoot.slice(1) },
          headers: { origin: api },
        })
        if (!workspace.ok())
          throw createScriptError(`Terminal workspace returned ${workspace.status()}.`)
        const { name, id } = await workspace.json()
        await page.goto(`${api}${basePath}~${encodeURIComponent(`${name}.${id}`)}/workbench`)
        await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
        await runPaletteCommand(page, 'Show terminal')
        Object.assign(report, await waitForTerminalPrompt(page, prompt))
        await selectors
          .terminalSurface(page)
          .first()
          .click({ button: 'right', position: { x: 100, y: 60 } })
        const row = selectors.terminalRendererRow(page)
        await row.waitFor({ timeout: 5_000 })
        const label = (await row.textContent())?.trim()
        report.rendererBackend =
          (['webgpu', 'webgl2', 'canvas2d', 'dom'] as const).find(
            (backend) => rendererBackendLabel(backend) === label,
          ) ?? null
        await page.keyboard.press('Escape')
        await page.screenshot({ path: path.join(out, 'live-terminal.png') })
        report.deployedRelease = await readRelease(new URL('release', target), signal, true)
        report.isolatedRelease = await readRelease(new URL('/release', server.origin), signal, true)
      } catch (error) {
        report.failures.push(
          `terminal check: ${error instanceof Error ? error.message : String(error)}`,
        )
        if (page) {
          report.count = await page
            .locator('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu')
            .filter({ visible: true })
            .count()
            .catch(() => 0)
          await page
            .screenshot({ path: path.join(out, 'live-terminal-failure.png') })
            .catch(() => {})
        }
      }
    },
    async () => {
      try {
        if (page) {
          await page.close().catch((error: unknown) => {
            report.failures.push(`terminal check: page cleanup failed: ${String(error)}`)
          })
          const request = page.request
          report.sessions = await Promise.all(
            sessions.map((session) => killCaptureTerminal(request, session)),
          )
          report.closed =
            report.sessions.length > 0 && report.sessions.every((session) => session.error === null)
        }
        if (observed) {
          Object.assign(report, serializable(observed))
          report.failures.push(
            ...observedProblems({
              ...observed,
              loopbackRequests: observed.loopbackRequests.filter(
                (url) =>
                  new URL(url).origin !== server?.origin && new URL(url).origin !== target.origin,
              ),
            }).map((failure) => `terminal check: ${failure}`),
          )
        }
      } finally {
        try {
          await browser?.close()
        } finally {
          await server?.stop({ logs: path.join(out, 'terminal-logs') })
        }
      }
    },
  )
  report.foreignRequests = foreignTerminalRequests(requests, [target.origin, server?.origin ?? ''])
  if (report.foreignRequests.length > 0)
    report.failures.push(
      `terminal check: off-origin dependencies: ${JSON.stringify(report.foreignRequests)}`,
    )
  report.failures.push(
    ...terminalFailures(report),
    ...terminalReleaseFailures(report.deployedRelease, report.isolatedRelease, PROTOCOL_VERSION),
  )
  return report
}

async function readRelease(url: URL, signal: AbortSignal, probe = false) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    redirect: 'error',
  })
  if (!response.ok) throw createScriptError(`Terminal release probe returned ${response.status}.`)
  const { release, commit, dirtyFiles, server, terminalHost } = await response.json()
  let terminalHostProbe
  if (probe) {
    const endpoint = new URL('terminal/health', url)
    const response = await fetch(endpoint, {
      headers: { origin: endpoint.origin },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      redirect: 'error',
    })
    if (!response.ok)
      throw createScriptError(`Fresh terminal-host probe returned ${response.status}.`, {
        internal: { status: response.status },
      })
    terminalHostProbe = await response.json()
  }
  return { release, commit, dirtyFiles, server, terminalHost, terminalHostProbe }
}

if (import.meta.main) {
  const [target, out, releaseRoot] = Bun.argv.slice(2)
  if (!target || !out || !releaseRoot)
    throw createScriptError(
      'Pass a target URL, evidence directory and built backend release directory.',
    )
  console.log(JSON.stringify(await checkLiveTerminal(new URL(target), out, releaseRoot)))
}
