import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { openFixtureChat } from './phone-fixture'
import type { Scenario } from './index'

/**
 * The phone's secondary surfaces: the folder picker as a full-screen sheet, the command palette
 * from a new session, and Settings with nothing that scrolls sideways.
 */
export const phoneSurfaces: Scenario = {
  name: 'phone-surfaces',
  description:
    'At a touch phone viewport: the folder picker fills the screen and opens folders on tap, a new session reaches the command palette, and Settings never scrolls sideways.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step }) {
    await folderPicker(page, step)
    const fixture = await createModifiedFileFixture(
      'phone-surfaces',
      'notes.md',
      ['# Notes', ''],
      ['# Notes', '', 'Changed.'],
    )
    try {
      await openFixtureChat(page, fixture)
      await newSessionPalette(page, step)
      await settings(page, step)
    } catch (error) {
      await step('failed')
      throw error
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function folderPicker(page: Page, step: (label: string) => Promise<void>) {
  const home = new URL(page.url())
  home.pathname = `${home.pathname.split('/~')[0]}/`
  home.search = ''
  home.hash = ''
  // The capture opened a workspace; the picker's own entry point is a window with none.
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(home.href, { waitUntil: 'domcontentloaded' })
  await selectors.chooseFolder(page).click()
  const dialog = page.locator('[data-slot="dialog-content"]')
  await dialog.waitFor()
  // Opened on a small folder: this machine's root and home listings are not under test.
  // The folder name in the bar is where a path is typed, as a phone's Files app does.
  await page.getByRole('button', { name: /^Go to folder/ }).click()
  await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill('/work/tmp/phone-ws')
  await page.keyboard.press('Enter')
  const list = page.getByRole('listbox')
  await list.getByRole('option').first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(400)
  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()
  ok(box && viewport, 'The picker must be laid out')
  ok(
    box.x <= 0.5 && box.width >= viewport.width - 0.5 && box.height >= viewport.height - 0.5,
    `The picker fills the phone screen: ${JSON.stringify(box)}`,
  )
  await expectNoSidewaysScroll(page, '[data-slot="dialog-content"]', '[aria-label="Places"]')
  await step('picker')

  // Folders show a trailing chevron: a tap drills in, and the bar's title follows.
  const folder = list.getByRole('option', { name: /^alpha/ })
  await folder.tap()
  await page
    .getByRole('button', { name: /^Go to folder, now \/work\/tmp\/phone-ws\/alpha/ })
    .waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Choose alpha', exact: true }).waitFor()
  await step('picker-tapped-folder')
  await page.getByRole('button', { name: 'More folder actions', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Newest first' }).waitFor()
  await step('picker-menu')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Up one folder', exact: true }).click()
  await page.getByRole('button', { name: 'Choose phone-ws', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function newSessionPalette(page: Page, step: (label: string) => Promise<void>) {
  await selectors.phoneLevel(page, 'sessions').waitFor({ timeout: 20_000 })
  await page
    .locator('[data-phone-shell]')
    .getByRole('button', { name: /new session/i })
    .first()
    .click()
  await selectors.phoneLevel(page, 'session').waitFor()
  await step('new-session')
  await selectors.phoneHeaderAction(page, 'Command palette').click()
  await selectors.paletteInput(page).waitFor()
  await step('new-session-palette')
  await page.keyboard.press('Escape')
  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'sessions').waitFor()
}

async function settings(page: Page, step: (label: string) => Promise<void>) {
  await selectors.phoneHeaderAction(page, 'Settings').click()
  await selectors.phoneLevel(page, 'file').waitFor()
  await page.locator('[data-phone-shell] header h1').getByText('Settings').waitFor()
  await page.waitForTimeout(800)
  await step('settings')
  await expectNoSidewaysScroll(page, '[data-phone-shell]')
  await expectNothingPastTheEdge(page)
}

/** WebKit pans a scroller sideways to reach any descendant box past its edge, clipped or not. */
async function expectNothingPastTheEdge(page: Page) {
  const offenders = await page.evaluate(async () => {
    const shell = document.querySelector('[data-phone-shell]')
    if (!shell) return ['missing shell']
    const scrollers = [...shell.querySelectorAll<HTMLElement>('*')].filter((element) => {
      const style = getComputedStyle(element)
      return (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight
      )
    })
    // Content inside its own sideways scroller or clip is contained there.
    const clippedBelow = (element: Element, scroller: Element) => {
      for (let node = element.parentElement; node && node !== scroller; node = node.parentElement)
        if (getComputedStyle(node).overflowX !== 'visible') return true
      return false
    }
    const found = new Set<string>()
    for (const scroller of scrollers) {
      const edge = scroller.getBoundingClientRect().right
      for (let top = 0; top <= scroller.scrollHeight; top += scroller.clientHeight / 2) {
        scroller.scrollTop = top
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
        for (const element of scroller.querySelectorAll('*')) {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.right <= edge + 1) continue
          if (clippedBelow(element, scroller)) continue
          found.add(
            `${element.tagName.toLowerCase()}[${element.getAttribute('aria-label') ?? element.getAttribute('data-slot') ?? ''}] in ${element.closest('[data-setting-id], [id]')?.getAttribute('data-setting-id') ?? element.closest('[id]')?.id} right=${Math.round(box.right)} edge=${Math.round(edge)}`,
          )
        }
      }
      scroller.scrollTop = 0
    }
    return [...found].slice(0, 20)
  })
  ok(offenders.length === 0, `Past the right edge: ${offenders.join(' | ')}`)
}

/** Nothing inside `root` scrolls sideways except the strips `strips` names, built to. */
async function expectNoSidewaysScroll(page: Page, root: string, strips = '') {
  const offenders = await page.evaluate(
    ([selector, stripSelector]) => {
      const scope = document.querySelector(selector!)
      if (!scope) return ['missing root']
      return [scope, ...scope.querySelectorAll('*')]
        .filter((element) => {
          const style = getComputedStyle(element)
          if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') return false
          if (stripSelector && element.matches(stripSelector)) return false
          return element.scrollWidth > element.clientWidth + 1
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 120)} ${element.scrollWidth}>${element.clientWidth}`,
        )
    },
    [root, strips],
  )
  ok(offenders.length === 0, `Scrolls sideways: ${offenders.join(' | ')}`)
}
