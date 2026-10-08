import { ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { committedFixture, openFixtureWorkspace } from '../fixture-workspace'
import {
  capturedTerminal,
  installCaptureTerminalNamespace,
  killCaptureTerminal,
} from '../product-terminal'
import {
  openFileFromTree,
  runPaletteCommand,
  selectors,
  workbenchPaintSelectors,
} from '../selectors'
import { stageRelease } from './server-update'
import type { Scenario } from './index'

const inspections = new WeakMap<Page, unknown>()

// A DOM readiness observation followed by two frame callbacks gives a paint opportunity.
// It does not prove presentation to a physical display.
async function paintOpportunity(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))
      }),
  )
}

export const workbenchMeasurements: Scenario = {
  name: 'workbench-measurements',
  requiresIsolatedServer: true,
  description:
    'Measure warm workspace reloads, editor tab switches and owned terminal replay across a server restart.',
  inspect: async (page) => inspections.get(page),
  async run(page, { server, step, evidence }) {
    ok(server, 'Measurements require a fixture-only isolated server')
    const fixture = await committedFixture('workbench-measurements')
    const prefix = `workbench-measure-${crypto.randomUUID()}-`
    const marker = `REPLAY_${crypto.randomUUID().replaceAll('-', '')}`
    const terminals = new Map<
      string,
      { socketUrl: string; killUrl: string; worktreeId: string; terminalId: string }
    >()
    const connections: { output: string; ready: boolean }[] = []
    page.on('websocket', (socket) => {
      const url = new URL(socket.url())
      if (!url.pathname.endsWith('/terminal')) return
      const terminal = capturedTerminal(socket.url(), prefix)
      ok(terminal, 'Only measurement-owned terminals may connect')
      terminals.set(socket.url(), terminal)
      const connection = { output: '', ready: false }
      connections.push(connection)
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') connection.output += payload.toString('utf8')
        else if (JSON.parse(payload).type === 'ready') connection.ready = true
      })
    })
    await installCaptureTerminalNamespace(page, prefix)
    await page.addInitScript((queries) => {
      // Vite pages need a release identity for the isolated server's update control.
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          if (document.querySelector('meta[name="platform-release"]')) return
          const meta = document.createElement('meta')
          meta.name = 'platform-release'
          meta.content = 'initial-release'
          document.head.append(meta)
        },
        { once: true },
      )
      const state = { workspaceMs: null as number | null, terminalMs: null as number | null }
      Object.assign(window, { workbenchPaint: state })
      let workspaceSeen = false
      let terminalSeen = false
      const visible = (element: Element) =>
        element.checkVisibility() && getComputedStyle(element).visibility === 'visible'
      const sample = () => {
        if (
          !workspaceSeen &&
          [...document.querySelectorAll(queries.editor)].some(
            (row) => visible(row) && row.textContent?.includes('WORKBENCH_SECOND'),
          ) &&
          [...document.querySelectorAll(queries.tree)].some(
            (row) => visible(row) && row.getAttribute('aria-label') === 'a.txt',
          )
        ) {
          workspaceSeen = true
          requestAnimationFrame(() => {
            state.workspaceMs = performance.now()
          })
        }
        if (!terminalSeen && [...document.querySelectorAll(queries.terminal)].some(visible)) {
          terminalSeen = true
          requestAnimationFrame(() => {
            state.terminalMs = performance.now()
          })
        }
        if (performance.now() < 30_000 && (!workspaceSeen || !terminalSeen))
          requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, workbenchPaintSelectors)
    const until = async (test: () => boolean, message: string) => {
      const deadline = performance.now() + 30_000
      while (!test() && performance.now() < deadline) await page.waitForTimeout(10)
      ok(test(), message)
    }
    const reloadMs: number[] = []
    const switchMs: number[] = []
    const terminalReloadMs: number[] = []
    try {
      await writeFile(path.join(fixture.path, 'a.txt'), 'WORKBENCH_FIRST\n'.repeat(100))
      await writeFile(path.join(fixture.path, 'b.txt'), 'WORKBENCH_SECOND\n'.repeat(100))
      await openFixtureWorkspace(page, fixture.path)
      await openFileFromTree(page, 'a.txt')
      await openFileFromTree(page, 'b.txt')
      await runPaletteCommand(page, 'Show terminal')
      await selectors.terminalSurface(page).first().waitFor()
      await until(() => connections.at(-1)?.ready === true, 'Shell must be ready')
      await selectors
        .terminalSurface(page)
        .first()
        .click({ position: { x: 100, y: 60 } })
      // The complete marker never appears in the echoed command.
      await page.keyboard.type(`printf '\\nREPLAY_%s\\n' '${marker.slice(7)}'`)
      await page.keyboard.press('Enter')
      await until(
        () => connections.at(-1)?.output.includes(marker) === true,
        'The shell must emit the unique marker',
      )
      await selectors.terminalLiveCanvas(page).first().waitFor()
      await step('fixture-ready')
      await page.waitForTimeout(1500)
      for (let index = 0; index < 5; index++) {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await selectors.editorRows(page).filter({ hasText: 'WORKBENCH_SECOND' }).first().waitFor()
        await selectors
          .folderTree(page)
          .getByRole('treeitem', { name: 'a.txt', exact: true })
          .first()
          .waitFor()
        await page.waitForFunction(
          'window.workbenchPaint?.workspaceMs !== null && window.workbenchPaint?.terminalMs !== null',
        )
        const painted = await page.evaluate<{ workspaceMs: number; terminalMs: number }>(
          'window.workbenchPaint',
        )
        reloadMs.push(painted.workspaceMs)
        terminalReloadMs.push(painted.terminalMs)
        for (const [name, content] of [
          ['a.txt', 'WORKBENCH_FIRST'],
          ['b.txt', 'WORKBENCH_SECOND'],
        ]) {
          await page.evaluate(
            'window.workbenchTabPressAt = null; document.addEventListener("pointerdown", (event) => { window.workbenchTabPressAt = event.timeStamp }, { once: true, capture: true })',
          )
          await selectors.editorTab(page, path.join(fixture.path, name!).slice(1)).click()
          await selectors.editorRows(page).filter({ hasText: content! }).first().waitFor()
          const paintedAt = await paintOpportunity(page)
          const start = await page.evaluate<number>('window.workbenchTabPressAt')
          switchMs.push(paintedAt - start)
        }
      }
      await step('warm-reloads-and-switches')
      await stageRelease(server)
      await selectors.serverUpdateApply(page).waitFor()
      server.restartDelayMs = 1000
      const before = connections.length
      let down = false
      let backAt: number | null = null
      const observeHealth = async () => {
        const deadline = performance.now() + 30_000
        while (performance.now() < deadline) {
          const response = await fetch(`${server.origin}/release`, {
            signal: AbortSignal.timeout(500),
          }).catch(() => null)
          if (!response?.ok) down = true
          if (down && response?.ok) {
            backAt = performance.now()
            return
          }
          await Bun.sleep(10)
        }
        ok(false, 'Restart must go offline and return within 30 seconds')
      }
      const health = observeHealth()
      await selectors.serverUpdateApply(page).click()
      await health
      await until(
        () => connections.slice(before).some((item) => item.ready && item.output.includes(marker)),
        'A fresh connection must replay the marker',
      )
      await selectors.terminalLiveCanvas(page).first().waitFor()
      await paintOpportunity(page)
      ok(backAt !== null)
      const serverBackToReplayMs = performance.now() - backAt
      strictEqual(
        new Set([...terminals.values()].map((item) => item.terminalId)).size,
        1,
        'Reload and restart retain the same shell identity',
      )
      const result = {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        method:
          'DOM content readiness plus two requestAnimationFrame callbacks; paint opportunity, not display presentation',
        terminalPaintGate:
          'Saved viewport canvas, or a live canvas after replay-complete and the native frame event remove inert',
        replayMarker: marker,
        healthPollMs: 10,
        workspaceReloadMs: reloadMs,
        editorTabSwitchMs: switchMs,
        terminalReloadFirstFrameMs: terminalReloadMs,
        serverBackToTerminalReplayMs: serverBackToReplayMs,
        freshReplayConnections: connections.length - before,
      }
      inspections.set(page, result)
      await evidence.json('workbench-measurements.json', result)
      await page.screenshot({ path: evidence.file('replayed-after-server-restart.png') })
      await step('replayed-after-server-restart')
    } catch (error) {
      await evidence.json(
        'measurement-failure.json',
        await page.evaluate(
          (queries) => ({
            paint: Reflect.get(window, 'workbenchPaint'),
            time: performance.now(),
            matches: Object.fromEntries(
              Object.entries(queries).map(([name, query]) => [
                name,
                [...document.querySelectorAll(query)].map((element) => ({
                  text: element.textContent?.slice(0, 100),
                  visible: element.checkVisibility(),
                  visibility: getComputedStyle(element).visibility,
                })),
              ]),
            ),
          }),
          workbenchPaintSelectors,
        ),
      )
      await page.screenshot({ path: evidence.file('measurement-failure.png') })
      await step('measurement-failure')
      throw error
    } finally {
      await page.goto('about:blank')
      for (const terminal of terminals.values()) {
        const result = await killCaptureTerminal(page.context().request, terminal)
        ok(!result.error, 'Measurement-owned shell cleanup must succeed')
      }
      await fixture.release()
    }
  },
}
