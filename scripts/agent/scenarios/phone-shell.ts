import { equal, ok } from 'node:assert/strict'
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
    'At a touch phone viewport: session list, session, changes, a diff, the terminal, and Back through each, with no horizontal scroll.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture(
      'phone-shell',
      'notes.md',
      ['# Notes', '', 'The upload retries twice.'],
      ['# Notes', '', 'The upload retries three times, then reports why.'],
    )
    try {
      const base = await openFixtureChat(page, fixture)
      await createSessions(page, base, fixture)
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
  await selectors.phoneLevel(page, 'sessions').waitFor({ timeout: 20_000 })
  await selectors.sessionRows(page).first().waitFor({ timeout: 20_000 })
  await expectFits(page)
  await step('sessions')

  await longPress(page, selectors.sessionByTitle(page, SESSIONS[1]!))
  await page.getByRole('menu').waitFor()
  await expectInsideViewport(page, page.getByRole('menu'))
  await step('row-long-press')
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'hidden' })

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

  await selectors.modelPickerTrigger(page).click()
  await selectors.modelPickerPanel(page).waitFor()
  await expectInsideViewport(page, selectors.modelPickerPanel(page))
  // Captured once the open animation has settled: floating UI is opaque at rest.
  await page.waitForTimeout(400)
  await step('model-picker')
  await page.keyboard.press('Escape')
  await selectors.modelPickerPanel(page).waitFor({ state: 'hidden' })

  await selectors.phoneHeaderAction(page, 'Changes').click()
  await selectors.phoneLevel(page, 'changes').waitFor()
  await selectors.gitChangeRow(page, 'notes.md').waitFor({ timeout: 20_000 })
  await expectFits(page)
  await step('changes')

  await selectors.gitChangeRow(page, 'notes.md').click()
  await selectors.phoneLevel(page, 'file').waitFor()
  await selectors.editorSurface(page).first().waitFor({ timeout: 20_000 })
  await expectFits(page)
  await step('diff')

  await page.goBack()
  await selectors.phoneLevel(page, 'changes').waitFor()
  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'session').waitFor()

  await selectors.phoneHeaderAction(page, 'Terminal').click()
  await selectors.phoneLevel(page, 'terminal').waitFor()
  await page.locator('[data-phone-level="terminal"] canvas').first().waitFor({ timeout: 20_000 })
  const keys = await recordTerminalKeys(page)
  await page
    .getByRole('toolbar', { name: 'Terminal keys' })
    .getByRole('button', { name: 'Up' })
    .click()
  await page
    .getByRole('toolbar', { name: 'Terminal keys' })
    .getByRole('button', { name: 'Esc' })
    .click()
  equal((await keys()).join(' '), 'ArrowUp Escape', 'The key row reaches the terminal input')
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

/** A held finger, as a touch screen sends it: no mouse events, 700ms between down and up. */
async function longPress(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  ok(box, 'The pressed row must be laid out')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await page.waitForTimeout(700)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

/** Collects the codes of keydowns that reach the terminal's input, from here on. */
async function recordTerminalKeys(page: Page) {
  await page.evaluate(() => {
    const input = document.querySelector('[data-phone-level="terminal"] textarea')
    const seen: string[] = []
    Object.assign(window, { phoneTerminalKeys: seen })
    input?.addEventListener('keydown', (event) => seen.push((event as KeyboardEvent).code))
  })
  return () =>
    page.evaluate(() => (window as unknown as { phoneTerminalKeys: string[] }).phoneTerminalKeys)
}
