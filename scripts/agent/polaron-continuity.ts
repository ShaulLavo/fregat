import { ok, strictEqual } from 'node:assert/strict'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Evidence } from './evidence'
import { installCaptureTerminalNamespace, killCaptureTerminal } from './product-terminal'
import { selectors } from './selectors'
import { openPolaronFixtureWindow } from './polaron-window'

export async function observePolaronTerminal(page: Page) {
  const prefix = `polaron-proof-${crypto.randomUUID()}-`
  const terminals = new Map<
    string,
    { socketUrl: string; killUrl: string; worktreeId: string; terminalId: string }
  >()
  let output = ''
  let readyCount = 0
  page.on('websocket', (socket) => {
    const url = new URL(socket.url())
    if (!url.pathname.endsWith('/terminal')) return
    const terminalId = url.searchParams.get('terminalId')
    const worktreeId = url.searchParams.get('worktreeId')
    ok(
      terminalId && terminalId.startsWith(prefix) && worktreeId,
      'Continuity proof can use only its isolated shells',
    )
    const kill = new URL(url)
    kill.protocol = kill.protocol === 'wss:' ? 'https:' : 'http:'
    kill.pathname += '/kill'
    kill.search = ''
    terminals.set(socket.url(), {
      socketUrl: socket.url(),
      killUrl: kill.href,
      worktreeId,
      terminalId,
    })
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') {
        output += payload.toString('utf8')
        return
      }
      if (JSON.parse(payload).type === 'ready') readyCount++
    })
  })
  await installCaptureTerminalNamespace(page, prefix)
  await page.reload()
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !condition()) await page.waitForTimeout(50)
    ok(condition(), 'The existing shared shell must answer with its retained variable')
  }
  const command = async (label: string, initialize = false) => {
    await selectors.terminalSurface(page).first().waitFor()
    await selectors
      .terminalSurface(page)
      .first()
      .click({ position: { x: 100, y: 60 } })
    await page.keyboard.type(
      `${initialize ? 'POLARON_SURVIVAL=retained; ' : ''}printf '\\n${label}_%s\\n' "$POLARON_SURVIVAL"`,
    )
    await page.keyboard.press('Enter')
    await until(() => output.includes(`${label}_retained`))
  }
  return {
    async prove(fixture: string, evidence: Evidence, step: (label: string) => Promise<void>) {
      await command('POLARON_BEFORE', true)
      const beforeReady = readyCount
      for (const mode of ['close', 'crash'] as const) {
        const window = await openPolaronFixtureWindow(
          page,
          path.join(fixture, `polaron-${mode}`),
          evidence,
        )
        try {
          await window.cdp
            .request(mode === 'close' ? 'Browser.close' : 'Browser.crash')
            .catch(() => {})
          await Promise.race([
            window.exited,
            Bun.sleep(5000).then(() => {
              ok(false, 'Owned Polaron browser must exit after close/crash')
            }),
          ])
          await window.close()
          ok(
            page.context().browser()?.isConnected(),
            'The existing Platform browser remains connected',
          )
          await command(`POLARON_AFTER_${mode.toUpperCase()}`)
          strictEqual(
            readyCount,
            beforeReady,
            'The existing terminal must keep its connection and shell',
          )
          await step(`shared-terminal-survives-${mode}`)
        } finally {
          await window.close()
        }
      }
      for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        await stopFixtureLauncherProcess(page, fixture, signal, evidence)
        ok(
          page.context().browser()?.isConnected(),
          'The existing app survives launcher-process termination',
        )
        await command(`POLARON_AFTER_LAUNCHER_${signal}`)
        strictEqual(
          readyCount,
          beforeReady,
          'Launcher termination leaves the existing shell connected',
        )
        await step(`shared-terminal-survives-launcher-${signal.toLowerCase()}`)
      }
      await evidence.json('polaron-continuity.json', {
        actualPlatformWindow: true,
        existingBrowserPreserved: true,
        retainedShellVariableAfterClose: true,
        retainedShellVariableAfterCrash: true,
        retainedShellAfterLauncherStop: true,
        retainedShellAfterLauncherKill: true,
        terminalReconnectsDuringCloseCrash: readyCount - beforeReady,
      })
    },
    async dispose() {
      const results = await Promise.all(
        [...terminals.values()].map((terminal) =>
          killCaptureTerminal(page.context().request, terminal),
        ),
      )
      ok(
        results.every((result) => result.error === null),
        'Only proof-owned terminal sessions are reaped',
      )
    },
  }
}

async function stopFixtureLauncherProcess(
  page: Page,
  fixture: string,
  signal: 'SIGTERM' | 'SIGKILL',
  evidence: Evidence,
) {
  const executable =
    Bun.which('chromium') ?? Bun.which('google-chrome') ?? Bun.which('google-chrome-stable')
  ok(executable, 'The launcher-process proof requires a real browser')
  const stateHome = path.join(fixture, `launcher-${signal.toLowerCase()}`)
  const readyFile = path.join(fixture, `launcher-${signal.toLowerCase()}.json`)
  const modulePath = path.resolve(
    import.meta.dirname,
    '../../apps/desktop/src/launcher/chromium.ts',
  )
  const source = `
    const { launchChromium } = await import(${JSON.stringify(modulePath)});
    const controller = new AbortController();
    process.once('SIGTERM', () => controller.abort());
    const browser = await launchChromium({
      candidate: { kind: 'chromium', executable: ${JSON.stringify(executable)}, args: ${JSON.stringify(process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? [] : ['--headless', '--no-sandbox'])}, confinement: 'none', source: 'setting', family: 'chromium' },
      stateHome: ${JSON.stringify(stateHome)}, home: ${JSON.stringify(stateHome)},
      url: ${JSON.stringify(new URL('/manifest.webmanifest', page.url()).href)},
      signal: controller.signal, onOpen: () => {}, onFailure: () => {}
    });
    if (browser.kind !== 'owned') process.exit(2);
    try {
      const info = await browser.cdp.request('SystemInfo.getProcessInfo');
      const owner = info.processInfo.find(process => process.type === 'browser');
      await Bun.write(${JSON.stringify(readyFile)}, JSON.stringify({ browserPid: owner.id }));
      await browser.exited;
    } finally { await browser.close(); }
  `
  const child = Bun.spawn([process.execPath, '-e', source], {
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  let browserPid: number | undefined
  try {
    const ready = Bun.file(readyFile)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !(await ready.exists()) && child.exitCode === null)
      await Bun.sleep(50)
    ok(await ready.exists(), 'The production-pipe launcher process must become ready')
    const info = (await ready.json()) as { browserPid: number }
    ok(
      Number.isSafeInteger(info.browserPid) && info.browserPid > 0,
      'The fixture records its own browser PID',
    )
    browserPid = info.browserPid
    child.kill(signal)
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(5000).then(() => {
        ok(false, 'Fixture launcher must exit')
      }),
    ])
    await evidence.json(`launcher-${signal.toLowerCase()}.json`, {
      signal,
      exitCode,
      existingBrowserConnected: page.context().browser()?.isConnected(),
    })
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    await child.exited
    // A killed fixture parent cannot reap its child; this PID came from its own private CDP session.
    await stopTrackedFixtureBrowser(browserPid)
  }
}

async function stopTrackedFixtureBrowser(pid: number | undefined) {
  if (!pid) return
  try {
    process.kill(pid, 'SIGTERM')
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && (await Bun.file(`/proc/${pid}/stat`).exists()))
      await Bun.sleep(25)
    if (await Bun.file(`/proc/${pid}/stat`).exists()) process.kill(pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
