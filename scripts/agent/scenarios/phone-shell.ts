import { equal, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { sendPrompt } from './native-provider-verification'
import { createSessions, openFixtureChat, PHONE_REPLY, PHONE_SESSIONS } from './phone-fixture'
import type { Scenario } from './index'

const SESSIONS = PHONE_SESSIONS
const REPLY = PHONE_REPLY

/**
 * The phone shell on a touch phone: the session list first, a session, its changes, a diff and
 * the terminal, each pushed onto the history, and Back through every one of them.
 */
export const phoneShell: Scenario = {
  name: 'phone-shell',
  description:
    'At a touch phone viewport: session list, session, pickers as bottom sheets, changes, diffs that share one editor tab, the terminal, and Back through each, with no horizontal scroll.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture(
      'phone-shell',
      'notes.md',
      ['# Notes', '', 'The upload retries twice.'],
      ['# Notes', '', 'The upload retries three times, then reports why.'],
    )
    try {
      // A second changed file, so the phone opens two files from the changes screen.
      await writeFile(path.join(fixture, 'todo.md'), '# Todo\n\nReport why the upload gave up.\n')
      const base = await openFixtureChat(page, fixture)
      await createSessions(page, base, fixture, 12)
      await walkTheStack(page, step)
    } catch (error) {
      await step('failed')
      throw error
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function walkTheStack(page: Page, step: (label: string) => Promise<void>) {
  const terminalInput = recordTerminalInput(page)
  await selectors.phoneLevel(page, 'sessions').waitFor({ timeout: 20_000 })
  await selectors.sessionRows(page).first().waitFor({ timeout: 20_000 })
  await expectFits(page)
  await step('sessions')

  await expectListScrollsUnderAFinger(page)

  // A hold well past the menu: lifting the finger must not press the item now under it.
  const held = selectors.sessionByTitle(page, SESSIONS[1]!)
  await longPress(page, held, 1_600)
  const menu = page.getByRole('menu')
  await menu.waitFor()
  await expectInsideViewport(page, menu)
  await page.waitForTimeout(300)
  ok(await menu.isVisible(), 'The menu is still open after the finger lifts')
  equal(await held.count(), 1, 'Nothing under the finger ran: the session keeps its title')
  await step('row-long-press')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })

  await selectors.phoneHeaderAction(page, 'Settings').click()
  await selectors.phoneLevel(page, 'file').waitFor()
  await page.locator('[data-phone-shell] header h1').getByText('Settings').waitFor()
  await expectFits(page)
  await step('settings')
  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'sessions').waitFor()

  await selectors.sessionByTitle(page, SESSIONS[0]!).click()
  await selectors.phoneLevel(page, 'session').waitFor()
  await sendPrompt(page, 'Why did the upload give up?')
  await page.getByText(REPLY).first().waitFor({ timeout: 30_000 })
  await expectFits(page)
  await step('session')

  // The chat commands with no control of their own are one palette away.
  await selectors.phoneHeaderAction(page, 'Session actions').click()
  await page.getByRole('menuitem', { name: /command palette/i }).click()
  await selectors.paletteInput(page).waitFor()
  await step('palette-from-menu')
  await page.keyboard.press('Escape')
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })

  await selectors.modelPickerTrigger(page).click()
  await selectors.modelPickerPanel(page).waitFor()
  await expectSheet(page, selectors.modelPickerPanel(page))
  await step('model-picker-sheet')
  // A tap on the scrim puts the sheet away, as on any phone.
  await page.touchscreen.tap(page.viewportSize()!.width / 2, 120)
  await selectors.modelPickerPanel(page).waitFor({ state: 'hidden' })

  // A menu of choices is a sheet too.
  await selectors.composerModes(page).click()
  await expectSheet(page, selectors.popupMenu(page))
  await step('choice-menu-sheet')
  await page.touchscreen.tap(page.viewportSize()!.width / 2, 120)
  await selectors.popupMenu(page).waitFor({ state: 'hidden' })

  await selectors.phoneHeaderAction(page, 'Changes').click()
  await selectors.phoneLevel(page, 'changes').waitFor()
  await selectors.gitChangeRow(page, 'notes.md').waitFor({ timeout: 20_000 })
  await expectFits(page)
  // No hover on a touch screen: the row's actions show at rest.
  const stage = selectors.gitFileRowAction(page, 'notes.md', 'Stage file')
  equal(await effectiveOpacity(stage), 1, 'The Stage button shows without a hover')
  await step('changes')

  await selectors.gitChangeRow(page, 'notes.md').click()
  await selectors.phoneLevel(page, 'file').waitFor()
  await selectors.editorSurface(page).first().waitFor({ timeout: 20_000 })
  await expectFits(page)
  await expectGutterInset(page)
  equal(addressTabs(page).length, 1, 'The diff opens one editor tab')
  await step('diff')

  // The phone has no tab strip: the next file it opens takes the place of the last one.
  await page.goBack()
  await selectors.phoneLevel(page, 'changes').waitFor()
  await selectors.gitChangeRow(page, 'todo.md').click()
  await selectors.phoneLevel(page, 'file').waitFor()
  await page.locator('[data-phone-shell] header h1').getByText('todo.md').waitFor()
  equal(addressTabs(page).length, 1, 'The second file replaces the first one’s tab')
  const previous = selectors.phoneHeaderAction(page, 'Previous file')
  const sibling = (await previous.isEnabled())
    ? previous
    : selectors.phoneHeaderAction(page, 'Next file')
  await sibling.click()
  await page.locator('[data-phone-shell] header h1').getByText('notes.md').waitFor()
  equal(addressTabs(page).length, 1, 'Stepping between files keeps one tab')
  await step('one-phone-tab')

  await page.goBack()
  await selectors.phoneLevel(page, 'changes').waitFor()
  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'session').waitFor()

  await selectors.phoneHeaderAction(page, 'Terminal').click()
  await selectors.phoneLevel(page, 'terminal').waitFor()
  await page.locator('[data-phone-level="terminal"] canvas').first().waitFor({ timeout: 20_000 })
  const input = page.locator('[data-phone-level="terminal"] textarea').first()
  // The pushed screen takes focus when it lands; the finger then lands on the terminal.
  await page.waitForFunction(() => document.activeElement?.matches('[data-phone-level="terminal"]'))
  // The terminal takes focus once its session is attached; until then a focus call is a no-op.
  await expectFocusable(input)
  const sentBefore = terminalInput().length
  const keys = page.getByRole('toolbar', { name: 'Terminal keys' })
  await keys.getByRole('button', { name: 'Up' }).tap()
  await keys.getByRole('button', { name: 'Esc' }).tap()
  await expectTerminalSent(terminalInput, sentBefore, '\x1b[A\x1b')
  ok(
    await input.evaluate((element) => element === document.activeElement),
    'The terminal keeps focus, so the keyboard stays up',
  )
  await step('terminal')

  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'session').waitFor()
  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'sessions').waitFor()
  equal(await selectors.phoneBack(page).count(), 0, 'The session list is the root: no Back')
  await step('back-to-sessions')
}

/** Nothing on a phone screen scrolls sideways: the shell is as wide as the viewport. */
async function expectFits(page: Page) {
  const widths = await page.evaluate(() => {
    const shell = document.querySelector('[data-phone-shell]')
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      shell: shell?.scrollWidth ?? 0,
    }
  })
  ok(widths.document <= widths.viewport, `The page scrolls sideways: ${JSON.stringify(widths)}`)
  ok(widths.shell <= widths.viewport, `The phone shell overflows: ${JSON.stringify(widths)}`)
}

/** A sheet or menu opens whole on the screen, never partly off an edge. */
async function expectInsideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  ok(box && viewport, 'The panel must be laid out')
  ok(
    box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 0.5,
    `The panel leaves the screen: ${JSON.stringify(box)}`,
  )
}

/** A picker on the phone is a bottom sheet: the full width up to its cap, on the bottom edge, over a scrim. */
async function expectSheet(page: Page, locator: Locator) {
  await locator.waitFor()
  // Measured once the rise has settled: floating UI is opaque at rest.
  await page.waitForTimeout(400)
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  ok(box && viewport, 'The sheet must be laid out')
  ok(
    Math.abs(box.y + box.height - viewport.height) <= 1,
    `The sheet sits on the bottom edge: ${JSON.stringify(box)}`,
  )
  ok(
    box.x <= 0.5 && box.width >= viewport.width - 1,
    `The sheet spans the phone: ${JSON.stringify(box)}`,
  )
  equal(await locator.getAttribute('data-presentation'), 'sheet')
  ok(await selectors.sheetBackdrop(page).isVisible(), 'A scrim covers the screen behind the sheet')
}

/** The editor's line numbers keep the phone's gutter inset off the screen edge. */
async function expectGutterInset(page: Page) {
  const gutter = selectors.phoneEditorGutter(page).first()
  await gutter.waitFor()
  const box = await gutter.boundingBox()
  ok(box, 'The gutter must be laid out')
  ok(box.x >= 8, `The gutter sits against the screen edge: x=${box.x}`)
}

/** The editor tabs the address records: one token per open tab. */
function addressTabs(page: Page) {
  const tabs = new URL(page.url()).searchParams.get('tabs')
  if (tabs === null || tabs === '-') return []
  return tabs.split('~')
}

/** A held finger, as a touch screen sends it: no mouse events between down and up. */
async function longPress(page: Page, locator: Locator, holdMs: number) {
  const box = await locator.boundingBox()
  ok(box, 'The pressed row must be laid out')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await page.waitForTimeout(holdMs)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

/** A finger dragged up the list scrolls it, and reorders nothing. */
async function expectListScrollsUnderAFinger(page: Page) {
  const list = page.locator('[data-phone-shell] [role="listbox"][aria-label="Sessions"]')
  const order = () => selectors.sessionRows(page).allInnerTexts()
  const before = await order()
  const box = await list.boundingBox()
  ok(box, 'The session list must be laid out')
  const x = box.x + box.width / 2
  const from = box.y + box.height * 0.8
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] })
  for (let step = 1; step <= 10; step += 1)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: from - step * 30 }],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  await page.waitForTimeout(300)
  ok((await list.evaluate((element) => element.scrollTop)) > 0, 'The list scrolled')
  equal((await order()).join('|'), before.join('|'), 'The drag reordered nothing')
  await list.evaluate((element) => element.scrollTo({ top: 0 }))
}

/** The opacity the element is drawn at: its own times every ancestor's. */
function effectiveOpacity(locator: Locator) {
  return locator.evaluate((element) => {
    let opacity = 1
    for (let node: Element | null = element; node; node = node.parentElement)
      opacity *= Number(getComputedStyle(node).opacity)
    return opacity
  })
}

/** Every byte the page sends to a terminal's shell connection, from here on, as text. */
function recordTerminalInput(page: Page) {
  let sent = ''
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.endsWith('/terminal')) return
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') sent += payload.toString('latin1')
    })
  })
  return () => sent
}

async function expectTerminalSent(sent: () => string, from: number, expected: string) {
  const deadline = Date.now() + 5_000
  while (!sent().slice(from).includes(expected)) {
    ok(
      Date.now() < deadline,
      `The shell connection did not receive the keys: ${JSON.stringify(sent().slice(from))}`,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function expectFocusable(input: Locator) {
  const deadline = Date.now() + 15_000
  for (;;) {
    await input.focus()
    if (await input.evaluate((element) => element === document.activeElement)) return
    ok(Date.now() < deadline, 'The terminal input never took focus')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}
