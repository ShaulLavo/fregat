import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { chords, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

type SocketCounts = { opened: number; closed: number }

function countTerminalSockets(page: Page) {
  const counts: SocketCounts = { opened: 0, closed: 0 }
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.endsWith('/terminal')) return
    counts.opened += 1
    socket.on('close', () => {
      counts.closed += 1
    })
  })
  return counts
}

async function terminalBox(page: Page) {
  const box = await selectors.terminalSurface(page).first().boundingBox()
  ok(box, 'The terminal surface must be measurable')
  return { width: Math.round(box.width), height: Math.round(box.height) }
}

export const bottomPanelPersistence: Scenario = {
  name: 'bottom-panel-persistence',
  description: 'Hide terminals every ordinary way, mode switch included; no socket may close.',
  async run(page, { step }) {
    const counts = countTerminalSockets(page)
    // The first socket opens before `run`; reload so the listener sees it.
    await page.reload()
    await waitForApp(page)
    await selectors.terminalSurface(page).first().waitFor()
    await page.waitForTimeout(1_000)
    const opened = counts.opened
    ok(opened > 0, 'The workbench terminal must open a socket')
    const before = await terminalBox(page)
    await step('terminal')

    await selectors.bottomTab(page, 'Problems').click()
    await page.waitForTimeout(500)
    await step('problems')
    await selectors.bottomTab(page, 'Terminal').click()
    await selectors.terminalSurface(page).first().waitFor()

    await page.keyboard.press(chords.togglePanel)
    await selectors.resizablePanel(page, 'bottom').waitFor({ state: 'detached' })
    await page.waitForTimeout(500)
    await step('collapsed')
    await page.keyboard.press(chords.togglePanel)
    await selectors.terminalSurface(page).first().waitFor()
    await page.waitForTimeout(500)
    const after = await terminalBox(page)
    await step('reopened')

    console.log(JSON.stringify({ workbench: counts, before, after }))
    deepStrictEqual(after, before, 'The reopened panel must come back at its chosen size')
    strictEqual(counts.closed, 0, 'Problems and Toggle panel must not close a terminal socket')
    strictEqual(counts.opened, opened, 'Nothing here should open another terminal socket')

    // The terminals live above the mode switch, so neither surface owns their lifetime.
    await selectors.bottomTab(page, 'Terminal').click()
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.toolTab(page, 'Terminal').waitFor()
    await page.waitForTimeout(500)
    strictEqual(counts.opened, opened, 'Entering chat mode must not spawn a session terminal')
    strictEqual(counts.closed, 0, 'Entering chat mode must not close the workbench terminal')

    await selectors.toolTab(page, 'Terminal').click()
    await selectors.terminalSurface(page).first().waitFor()
    await page.waitForTimeout(1_000)
    await step('chat-terminal')
    await selectors.toolTab(page, 'Git').click()
    await page.waitForTimeout(500)
    await step('chat-git')
    await selectors.toolTab(page, 'Git').click()
    await selectors.resizablePanel(page, 'tools').waitFor({ state: 'detached' })
    await step('chat-collapsed')
    await selectors.toolTab(page, 'Terminal').click()
    await selectors.terminalSurface(page).first().waitFor()
    await page.waitForTimeout(500)
    await step('chat-reopened')

    await selectors.workspaceMode(page, 'Workbench').click()
    await selectors.terminalSurface(page).first().waitFor()
    await page.waitForTimeout(500)
    const back = await terminalBox(page)
    await step('workbench-again')

    console.log(JSON.stringify({ total: counts, back }))
    deepStrictEqual(back, before, 'The workbench terminal must come back at its size')
    strictEqual(counts.opened, opened + 1, 'One session terminal, opened exactly once')
    strictEqual(counts.closed, 0, 'No way of hiding a terminal may close its socket')
  },
}
