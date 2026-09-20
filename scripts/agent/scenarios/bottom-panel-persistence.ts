import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { chords, runPaletteCommand, selectors, waitForApp } from '../selectors'
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

/** A collapsed panel keeps its children, so visibility cannot tell it from an open one. */
async function waitForExtent(page: Page, id: string, side: 'width' | 'height', extent: number) {
  await selectors.resizablePanel(page, id).waitFor({ state: 'attached' })
  await page.waitForFunction(
    ([selector, key, expected]) =>
      Math.round(document.querySelector(selector)?.getBoundingClientRect()[key] ?? -1) === expected,
    [`[data-slot="resizable-panel"][id="${id}"]`, side, extent] as const,
  )
}

export const bottomPanelPersistence: Scenario = {
  name: 'bottom-panel-persistence',
  description: 'Hide and re-show terminals every ordinary way; their sockets must stay open.',
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
    await waitForExtent(page, 'bottom', 'height', 0)
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

    // Leaving the workbench still unmounts its terminal, so the chat half counts afresh.
    await selectors.bottomTab(page, 'Terminal').click()
    await runPaletteCommand(page, 'Chat mode')
    await selectors.toolTab(page, 'Terminal').waitFor()
    await page.waitForTimeout(500)
    const chatBase = { ...counts }
    strictEqual(chatBase.opened, opened, 'Entering chat mode must not spawn a session terminal')

    await selectors.toolTab(page, 'Terminal').click()
    await selectors.terminalSurface(page).first().waitFor()
    await page.waitForTimeout(1_000)
    await step('chat-terminal')
    await selectors.toolTab(page, 'Git').click()
    await page.waitForTimeout(500)
    await step('chat-git')
    await selectors.toolTab(page, 'Git').click()
    await waitForExtent(page, 'tools', 'width', 0)
    await step('chat-collapsed')
    await selectors.toolTab(page, 'Terminal').click()
    await selectors.terminalSurface(page).first().waitFor()
    await page.waitForTimeout(500)
    await step('chat-reopened')

    console.log(JSON.stringify({ chat: counts, chatBase }))
    strictEqual(counts.opened, chatBase.opened + 1, 'The session terminal opens exactly once')
    strictEqual(counts.closed, chatBase.closed, 'Tool switches and collapse must not close it')
  },
}
