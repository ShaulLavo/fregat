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
      for (let index = 0; index < 30; index++)
        await mkdir(path.join(fixture, `folder-${String(index).padStart(2, '0')}`))
      await mkdir(path.join(fixture, 'zulu'))
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
  // The capture opened a workspace; the phone opens the picker from an empty session rail.
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(home.href, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
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
  // A folder picker lists folders only.
  ok(
    (await list.getByRole('option', { name: /^notes\.md/ }).count()) === 0,
    'A folder picker hides files',
  )

  // A tap far down a scrolled list opens that row; focusing the list must not jump to the top.
  await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  const last = list.getByRole('option', { name: /^zulu/ })
  await last.waitFor()
  await page.waitForTimeout(300)
  await last.tap()
  await page
    .getByRole('button', { name: `Go to folder, now ${fixture}/zulu`, exact: true })
    .waitFor({ timeout: 10_000 })
  await step('picker-tapped-last-folder')
  await page.getByRole('button', { name: `Back to ${path.basename(fixture)}`, exact: true }).tap()
  await page
    .getByRole('button', { name: `Go to folder, now ${fixture}`, exact: true })
    .waitFor({ timeout: 10_000 })
  // The filesystem root is the empty path; Back must still return to it.
  await page.getByRole('button', { name: /^Go to folder/ }).click()
  await selectors.pickerFolderPath(page).fill('/')
  await page.keyboard.press('Enter')
  await list.getByRole('option', { name: /^tmp/ }).tap()
  await page
    .getByRole('button', { name: 'Go to folder, now /tmp', exact: true })
    .waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Back to Root', exact: true }).tap()
  await page
    .getByRole('button', { name: 'Go to folder, now /', exact: true })
    .waitFor({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
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

/**
 * The draft's setup is one control flush with the bottom edge. Its sheet lists every setting with
 * the full value, and each setting's choices open inside that sheet, never as a second one.
 */
async function draftContext(page: Page, step: (label: string) => Promise<void>) {
  const setup = selectors.draftSetup(page)
  const sheet = selectors.draftSetupSheet(page)
  const row = (label: string) => selectors.draftSetupRow(page, label)
  await setup.waitFor()
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expectOneRowControl(page, width)
    await step(`draft-summary-${width}`)
    await setup.click()
    const branch = sheet.getByText(BRANCH, { exact: true })
    await branch.waitFor()
    const size = await branch.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
      right: element.getBoundingClientRect().right,
    }))
    ok(size.client > 0 && size.scroll <= size.client + 1, `Branch clipped: ${JSON.stringify(size)}`)
    ok(size.right <= width, 'The branch stays inside the phone')
    await expectNoSidewaysScroll(page, '[role="menu"][data-presentation="sheet"]')
    await step(`draft-setup-${width}`)
    await row('Workspace').click()
    await page.getByRole('menuitemradio', { name: 'Current checkout', exact: true }).waitFor()
    await expectOneSheet(page)
    await step(`workspace-choices-${width}`)
    // Escape (the phone's Back gesture) steps back to the overview before it closes the sheet.
    await page.keyboard.press('Escape')
    await row('Agent').waitFor()
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
    ok(
      await setup.evaluate((element) => element === document.activeElement),
      'Focus returns to setup',
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await setup.click()
  await row('Agent').click()
  await page.getByRole('menuitemradio', { name: 'Default agent', exact: true }).click()
  await row('Agent').waitFor()
  await row('Workspace').click()
  await page.getByRole('menuitemradio', { name: 'New worktree', exact: true }).click()
  await row('Starts from').click()
  const choice = page
    .getByRole('menuitemradio', { name: BRANCH })
    .getByText(BRANCH, { exact: true })
  await choice.waitFor()
  const clipped = await choice.evaluate((element) => element.scrollWidth > element.clientWidth + 1)
  ok(!clipped, 'The branch choice shows its full name')
  await expectOneSheet(page)
  await step('draft-branch-choices')
  await sheet.getByRole('menuitem', { name: 'Back to session setup', exact: true }).click()
  await row('Starts from').waitFor()
  await step('draft-setup-new-worktree')
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  ok(
    (await setup.textContent())?.includes('New worktree from'),
    'The summary names the new worktree',
  )
  await expectOneRowControl(page, 390)
  await step('draft-summary-new-worktree')
  // Back to the checkout: no worktree is made, since nothing is sent.
  await setup.click()
  await row('Workspace').click()
  await page.getByRole('menuitemradio', { name: 'Current checkout', exact: true }).click()
  await row('Workspace').waitFor()
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
}

/** The setup control is one row inside the phone, with no space between it and the bottom edge. */
async function expectOneRowControl(page: Page, width: number) {
  const trigger = await selectors.draftSetup(page).boundingBox()
  ok(
    trigger && trigger.height <= 44 && trigger.x + trigger.width <= width,
    'One phone control fits',
  )
  ok(Math.abs(trigger.y + trigger.height - 844) <= 1, 'No extra space below the setup control')
}

async function expectOneSheet(page: Page) {
  const open = await page.locator('[data-presentation="sheet"][data-open]').count()
  ok(open === 1, `One sheet is open, not ${open}`)
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
