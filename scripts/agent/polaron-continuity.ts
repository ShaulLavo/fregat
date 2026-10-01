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
        const automaticExit = await stopFixtureLauncherProcess(page, fixture, signal, evidence)
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
        ok(automaticExit, 'Launcher termination and pipe EOF must leave no live owned browser')
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
  const failurePath = path.resolve(
    import.meta.dirname,
    '../../apps/desktop/src/launcher/failure.ts',
  )
  const errorFile = path.join(fixture, `launcher-${signal.toLowerCase()}-failure.json`)
  const phaseFile = path.join(fixture, `launcher-${signal.toLowerCase()}-phase.json`)
  const source = `
    const phase = async value => await Bun.write(${JSON.stringify(phaseFile)}, JSON.stringify({ phase: value }));
    await phase('import');
    try {
    const { launchChromium } = await import(${JSON.stringify(modulePath)});
    await phase('launch');
    const controller = new AbortController();
    process.once('SIGTERM', () => controller.abort());
    const browser = await launchChromium({
      candidate: { kind: 'chromium', executable: ${JSON.stringify(executable)}, args: ${JSON.stringify(process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? [] : ['--headless', '--no-sandbox'])}, confinement: 'none', source: 'setting', family: 'chromium' },
      stateHome: ${JSON.stringify(stateHome)}, home: ${JSON.stringify(stateHome)},
      url: ${JSON.stringify(new URL('/manifest.webmanifest', page.url()).href)},
      signal: controller.signal, onOpen: () => {}, onFailure: () => {}
    });
    if (browser.kind !== 'owned') process.exit(2);
    await phase('process-info');
    try {
      const info = await browser.cdp.request('SystemInfo.getProcessInfo');
      const owner = info.processInfo.find(process => process.type === 'browser');
      await Bun.write(${JSON.stringify(readyFile)}, JSON.stringify({ browserPid: owner.id }));
      await browser.exited;
    } finally { await browser.close(); }
    } catch (error) {
      const { launcherFailureFacts } = await import(${JSON.stringify(failurePath)});
      await Bun.write(${JSON.stringify(errorFile)}, JSON.stringify(launcherFailureFacts(error)));
      process.exitCode = 1;
    }
  `
  const child = Bun.spawn([process.execPath, '-e', source], {
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  let browserIdentity: { pid: number; startTime: string } | undefined
  try {
    // Bun.file caches a missing file; each readiness poll needs a fresh file view.
    const ready = () => Bun.file(readyFile)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !(await ready().exists()) && child.exitCode === null)
      await Bun.sleep(50)
    if (!(await ready().exists())) {
      const failure = Bun.file(errorFile)
      await evidence.json(`launcher-${signal.toLowerCase()}-startup.json`, {
        exitCode: child.exitCode,
        failure: (await failure.exists()) ? await failure.json() : null,
        phase: (await Bun.file(phaseFile).exists()) ? await Bun.file(phaseFile).json() : null,
      })
    }
    ok(await ready().exists(), 'The production-pipe launcher process must become ready')
    const info = (await ready().json()) as { browserPid: number }
    ok(
      Number.isSafeInteger(info.browserPid) && info.browserPid > 0,
      'The fixture records its own browser PID',
    )
    const observed = await readFixtureProcess(info.browserPid)
    ok(
      observed && observed.state !== 'Z',
      'The private CDP browser must be live before launcher termination',
    )
    browserIdentity = { pid: info.browserPid, startTime: observed.startTime }
    child.kill(signal)
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(5000).then(() => {
        ok(false, 'Fixture launcher must exit')
      }),
    ])
    const cleanupDeadline = Date.now() + 5000
    while (Date.now() < cleanupDeadline && (await trackedFixtureBrowserLives(browserIdentity)))
      await Bun.sleep(25)
    const automaticExit = !(await trackedFixtureBrowserLives(browserIdentity))
    await evidence.json(`launcher-${signal.toLowerCase()}.json`, {
      signal,
      exitCode,
      ownedBrowserAutoExited: automaticExit,
      existingBrowserConnected: page.context().browser()?.isConnected(),
    })
    if (signal === 'SIGTERM')
      strictEqual(exitCode, 0, 'Graceful production launcher cleanup must succeed')
    return automaticExit
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await Promise.race([child.exited, Bun.sleep(5000)])
    }
    if (child.exitCode === null) child.kill('SIGKILL')
    await child.exited
    // A killed fixture parent cannot reap its child; this PID came from its own private CDP session.
    await stopTrackedFixtureBrowser(browserIdentity)
  }
}

async function readFixtureProcess(pid: number) {
  let stat: string
  try {
    stat = await Bun.file(`/proc/${pid}/stat`).text()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')
  const startTime = fields[19]
  ok(startTime, 'The tracked process must expose its Linux start-time identity')
  return { state: fields[0], startTime }
}

async function trackedFixtureBrowserLives(identity: { pid: number; startTime: string }) {
  const observed = await readFixtureProcess(identity.pid)
  return (
    observed?.startTime === identity.startTime && observed.state !== 'Z' && observed.state !== 'X'
  )
}

async function stopTrackedFixtureBrowser(identity: { pid: number; startTime: string } | undefined) {
  if (!identity || !(await trackedFixtureBrowserLives(identity))) return
  try {
    process.kill(identity.pid, 'SIGTERM')
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && (await trackedFixtureBrowserLives(identity)))
      await Bun.sleep(25)
    if (await trackedFixtureBrowserLives(identity)) process.kill(identity.pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
