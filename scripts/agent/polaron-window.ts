import { ok } from 'node:assert/strict'
import path from 'node:path'
import type { Page } from 'playwright'
import { launchChromium } from '../../apps/desktop/src/launcher/chromium'
import type { Evidence } from './evidence'
import { killCaptureTerminal } from './product-terminal'

// The inert same-origin manifest lets fixture wiring land before the app's first script runs.
export async function openPolaronFixtureWindow(page: Page, stateHome: string, evidence: Evidence) {
  const executable =
    Bun.which('chromium') ?? Bun.which('google-chrome') ?? Bun.which('google-chrome-stable')
  ok(executable, 'A real Chromium executable is required for launcher continuity proof')
  const serverUrl = await page.evaluate(
    () => (window as { platformDevServerUrl?: string }).platformDevServerUrl,
  )
  ok(serverUrl, 'The Polaron app window must use the throwaway API server')
  const browserWindow = await launchChromium({
    candidate: {
      kind: 'chromium',
      executable,
      args:
        process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? [] : ['--headless', '--no-sandbox'],
      confinement: 'none',
      source: 'setting',
      family: 'chromium',
    },
    stateHome,
    home: stateHome,
    url: new URL('/manifest.webmanifest', page.url()).href,
    onOpen: () => {},
    onFailure: () => {},
  })
  ok(browserWindow.kind === 'owned', 'The isolated Polaron profile must be owned')
  const prefix = path.basename(stateHome) + '-'
  const terminals = new Map<
    string,
    { socketUrl: string; killUrl: string; worktreeId: string; terminalId: string }
  >()
  const detach = browserWindow.cdp.on('Network.webSocketCreated', (event) => {
    if (typeof event.params.url !== 'string') return
    const url = new URL(event.params.url)
    if (!url.pathname.endsWith('/terminal')) return
    const terminalId = url.searchParams.get('terminalId')
    const worktreeId = url.searchParams.get('worktreeId')
    ok(
      terminalId && terminalId.startsWith(prefix) && worktreeId,
      'The owned app window uses only its fixture terminals',
    )
    const kill = new URL(url)
    kill.protocol = kill.protocol === 'wss:' ? 'https:' : 'http:'
    kill.pathname += '/kill'
    kill.search = ''
    terminals.set(url.href, { socketUrl: url.href, killUrl: kill.href, worktreeId, terminalId })
  })
  const close = async () => {
    await browserWindow.close()
    detach()
    const results = await Promise.all(
      [...terminals.values()].map((terminal) =>
        killCaptureTerminal(page.context().request, terminal),
      ),
    )
    terminals.clear()
    ok(
      results.every((result) => result.error === null),
      'Owned app-window fixture terminals are reaped',
    )
  }
  try {
    const targets = await browserWindow.cdp.request('Target.getTargets')
    const target = (targets.targetInfos as { targetId: string; type: string }[]).find(
      (value) => value.type === 'page',
    )
    ok(target, 'The inert Polaron app target must exist')
    const attached = await browserWindow.cdp.request('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
    const session = attached.sessionId as string
    await browserWindow.cdp.request('Network.enable', {}, session)
    await browserWindow.cdp.request(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `window.platformDevServerUrl = ${JSON.stringify(serverUrl)}; sessionStorage.setItem('fregat.terminal-namespace', ${JSON.stringify(prefix)});`,
      },
      session,
    )
    await browserWindow.cdp.request('Page.navigate', { url: page.url() }, session)
    const deadline = Date.now() + 15_000
    let ready = false
    while (Date.now() < deadline) {
      const result = await browserWindow.cdp.request(
        'Runtime.evaluate',
        {
          expression: `Boolean(document.querySelector('[aria-label="Window toolbar"]') && globalThis.platformBridge?.titlebar === 'native' && globalThis.platformDevServerUrl === ${JSON.stringify(serverUrl)} && Boolean(document.querySelector('[aria-label="Folder tree"] [role="treeitem"][aria-label="a.txt"]')))`,
          returnByValue: true,
        },
        session,
      )
      ready = (result.result as { value?: unknown }).value === true
      if (ready) break
      await Bun.sleep(50)
    }
    const inspection = await browserWindow.cdp.request(
      'Runtime.evaluate',
      {
        expression: `JSON.stringify({ href: location.href, toolbar: Boolean(document.querySelector('[aria-label="Window toolbar"]')), titlebar: globalThis.platformBridge?.titlebar, fixtureApi: globalThis.platformDevServerUrl === ${JSON.stringify(serverUrl)}, tree: Array.from(document.querySelectorAll('[role="treeitem"]')).map(row => row.textContent), body: document.body?.innerText })`,
        returnByValue: true,
      },
      session,
    )
    await evidence.json(path.basename(stateHome) + '-readiness.json', inspection.result)
    const screenshot = await browserWindow.cdp.request(
      'Page.captureScreenshot',
      { format: 'png' },
      session,
    )
    await evidence.write(
      path.basename(stateHome) + '.png',
      Buffer.from(screenshot.data as string, 'base64'),
    )
    ok(
      ready,
      'Actual Platform must render using the throwaway API in the owned Chromium app window',
    )
    return { ...browserWindow, close }
  } catch (error) {
    await close()
    throw error
  }
}
