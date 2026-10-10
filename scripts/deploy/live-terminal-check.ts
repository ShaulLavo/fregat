import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import { terminalFailures, waitForTerminalPrompt } from './live-terminal.mjs'

const prompt = 'fregat-live-check$'

async function checkLiveTerminal(target: URL, out: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fregat-live-terminal-'))
  const webRoot = path.join(directory, 'web')
  const workspaceRoot = path.join(directory, 'workspace')
  const prefix = `live-check-${crypto.randomUUID()}-`
  const sessions: CaptureTerminal[] = []
  const report = {
    count: 0,
    promptRendered: false,
    rendererBackend: null as string | null,
    closed: false,
    failures: [] as string[],
    sessions: [] as Awaited<ReturnType<typeof killCaptureTerminal>>[],
  }
  let server: IsolatedServer | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let observed: ReturnType<typeof attachObserver> | undefined
  const stop = () => {
    void browser?.close()
  }
  process.once('SIGTERM', stop)
  try {
    await mkdir(webRoot)
    await mkdir(workspaceRoot)
    const response = await fetch(target, { signal: AbortSignal.timeout(30_000) })
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
      settings: { 'terminal.integrated.screenReader': true },
    })
    const live = await openLiveBrowser(chromium)
    browser = live.browser
    page = live.page
    await page.context().grantPermissions(['local-network-access'], { origin: server.origin })
    observed = attachObserver(page, server.origin)
    const api = server.origin
    const basePath = target.pathname
    await page.route(`${api}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const relative = url.pathname.startsWith(basePath)
        ? url.pathname.slice(basePath.length)
        : url.pathname.slice(1)
      if (
        relative.startsWith('assets/') ||
        ['script', 'stylesheet', 'font', 'image'].includes(request.resourceType())
      ) {
        const asset = await route.fetch({
          url: new URL(relative + url.search, target).href,
          method: 'GET',
          headers: { accept: request.headers().accept ?? '*/*', origin: target.origin },
        })
        return route.fulfill({ response: asset })
      }
      if (request.resourceType() === 'document') {
        const document = await route.fetch({ url: `${api}/${relative}${url.search}` })
        return route.fulfill({
          response: document,
          headers: { ...document.headers(), ...documentHeaders },
        })
      }
      if (basePath !== '/' && url.pathname.startsWith(basePath))
        return route.fulfill({
          response: await route.fetch({ url: `${api}/${relative}${url.search}` }),
        })
      return route.continue()
    })
    await page.addInitScript((basePath) => {
      const NativeSocket = window.WebSocket
      window.WebSocket = class extends NativeSocket {
        constructor(address: string | URL, protocols?: string | string[]) {
          const url = new URL(address, location.href)
          if (url.host === location.host && basePath !== '/' && url.pathname.startsWith(basePath))
            url.pathname = `/${url.pathname.slice(basePath.length)}`
          super(url, protocols)
        }
      }
    }, basePath)
    await installCaptureTerminalNamespace(page, prefix)
    page.on('websocket', (socket) => {
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
      await page.screenshot({ path: path.join(out, 'live-terminal-failure.png') }).catch(() => {})
    }
  } finally {
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
        ...observedProblems(observed, { loopback: false }).map(
          (failure) => `terminal check: ${failure}`,
        ),
      )
    }
    try {
      await browser?.close()
    } finally {
      await server?.stop({ logs: path.join(out, 'terminal-logs') })
      await rm(directory, { recursive: true, force: true })
      process.removeListener('SIGTERM', stop)
    }
  }
  report.failures.push(...terminalFailures(report))
  return report
}

if (import.meta.main) {
  const [target, out] = Bun.argv.slice(2)
  if (!target || !out) throw createScriptError('Pass a target URL and evidence directory.')
  console.log(JSON.stringify(await checkLiveTerminal(new URL(target), out)))
}
