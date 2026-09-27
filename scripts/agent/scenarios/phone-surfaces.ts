import { ok } from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { createModifiedFileFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { openFixtureChat } from './phone-fixture'
import type { Scenario } from './index'

const BRANCH = 'fix/phone-composer-controls-stay-readable-on-narrow-screens'

/**
 * The phone's secondary surfaces: the folder picker as a full-screen sheet, the command palette
 * from a new session, and Settings contained within the phone viewport.
 */
export const phoneSurfaces: Scenario = {
  name: 'phone-surfaces',
  description:
    'At a touch phone viewport: the folder picker fills the screen and opens folders on tap, a new session reaches the command palette, and Settings never scrolls sideways.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture(
      'phone-surfaces',
      'notes.md',
      ['# Notes', ''],
      ['# Notes', '', 'Changed.'],
    )
    try {
      await fixtureGit(fixture, ['branch', '-m', BRANCH])
      await mkdir(path.join(fixture, 'alpha'))
      await folderPicker(page, step, fixture)
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

async function folderPicker(page: Page, step: (label: string) => Promise<void>, fixture: string) {
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
  const dialog = selectors.pickerDialog(page)
  await dialog.waitFor()
  // Opened on a small folder: this machine's root and home listings are not under test.
  // The folder name in the bar is where a path is typed, as a phone's Files app does.
  await page.getByRole('button', { name: /^Go to folder/ }).click()
  await selectors.pickerFolderPath(page).fill(fixture)
  await page.keyboard.press('Enter')
  const list = selectors.pickerList(page)
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
    .getByRole('button', { name: `Go to folder, now ${fixture}/alpha`, exact: true })
    .waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Choose alpha', exact: true }).waitFor()
  await step('picker-tapped-folder')
  await page.getByRole('button', { name: 'More folder actions', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Newest first' }).waitFor()
  await step('picker-menu')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Up one folder', exact: true }).click()
  await page
    .getByRole('button', { name: `Choose ${path.basename(fixture)}`, exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function newSessionPalette(page: Page, step: (label: string) => Promise<void>) {
  await selectors.phoneLevel(page, 'sessions').waitFor({ timeout: 20_000 })
  await selectors
    .phoneShell(page)
    .getByRole('button', { name: /new session/i })
    .first()
    .click()
  await selectors.phoneLevel(page, 'session').waitFor()
  await draftContext(page, step)
  await step('new-session')
  await selectors.phoneHeaderAction(page, 'Command palette').click()
  await selectors.paletteInput(page).waitFor()
  await step('new-session-palette')
  await page.keyboard.press('Escape')
  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'sessions').waitFor()
}

async function draftContext(page: Page, step: (label: string) => Promise<void>) {
  const context = selectors.draftContext(page)
  await context.waitFor()
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const branch = context.getByText(BRANCH, { exact: true })
    await branch.waitFor()
    const size = await branch.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
      right: element.getBoundingClientRect().right,
    }))
    ok(size.client > 0 && size.scroll <= size.client + 1, `Branch clipped: ${JSON.stringify(size)}`)
    ok(size.right <= width, 'The branch stays inside the phone')
    await expectNoSidewaysScroll(page, '[aria-label="Session workspace"]')
    await context.getByRole('button', { name: 'Workspace', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Current checkout', exact: true }).waitFor()
    await step(`workspace-sheet-${width}`)
    await page.keyboard.press('Escape')
    await step(`draft-context-${width}`)
  }
  await context.getByRole('button', { name: 'Run the session as an agent' }).click()
  await page.getByRole('menuitemradio', { name: 'Default agent', exact: true }).click()
  await context.getByRole('button', { name: 'Workspace', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'New worktree', exact: true }).click()
  await context.getByRole('button', { name: 'Start from branch', exact: true }).click()
  await page.getByRole('menuitemradio', { name: BRANCH }).waitFor()
  await step('draft-branch-sheet')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
}

async function settings(page: Page, step: (label: string) => Promise<void>) {
  await selectors.phoneHeaderAction(page, 'Settings').click()
  await selectors.phoneLevel(page, 'file').waitFor()
  await page.locator('[data-phone-shell] header h1').getByText('Settings').waitFor()
  await page.waitForTimeout(800)
  await step('settings')
  await expectNoSidewaysScroll(page, '[data-phone-shell]', '.no-scrollbar')
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
        element.clientHeight > 0 &&
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
      const rootBox = scope.getBoundingClientRect()
      return [document.documentElement, document.body, scope, ...scope.querySelectorAll('*')]
        .filter((element) => {
          if (
            element === scope ||
            element === document.documentElement ||
            element === document.body
          )
            return element.scrollWidth > element.clientWidth + 1
          const style = getComputedStyle(element)
          if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') return false
          if (stripSelector && element.matches(stripSelector)) {
            const box = element.getBoundingClientRect()
            return box.left < rootBox.left - 1 || box.right > rootBox.right + 1
          }
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
