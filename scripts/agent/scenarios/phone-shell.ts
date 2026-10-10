import { equal, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page, Request } from 'playwright'
import { isRecord } from '@workspace/utils/objects'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { longPress } from '../touch'
import { sendPrompt } from './native-provider-verification'
import { createSessions, openFixtureChat, PHONE_REPLY, PHONE_SESSIONS } from './phone-fixture'
import { expectPhoneSafeAreas } from './phone-safe-areas'
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
    const requests: string[] = []
    const recordRequest = (request: Request) => requests.push(request.url())
    page.on('request', recordRequest)
    await page.reload({ waitUntil: 'commit' })
    await page.locator(selectors.phoneFirstScreenSelector).waitFor()
    const viewport = await page.evaluate(selectors.phoneViewportPolicy)
    ok(
      isRecord(viewport) &&
        typeof viewport.resizesContent === 'boolean' &&
        typeof viewport.virtualKeyboard === 'boolean',
      'The browser reports its viewport policy',
    )
    equal(
      viewport.resizesContent,
      viewport.virtualKeyboard,
      'Viewport hint follows keyboard support',
    )
    page.off('request', recordRequest)
    const desktopRequests = requests.filter((url) => /workbench-[^/]+[.](js|css)$/.test(url))
    equal(
      desktopRequests.length,
      0,
      `Phone boot fetched desktop chunks: ${desktopRequests.join(', ')}`,
    )
    const originalUrl = page.url()
    const fixture = await createModifiedFileFixture(
      'phone-shell',
      'notes.md',
      notesWith('The upload retries twice.'),
      notesWith('The upload retries three times, then reports why.'),
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
      await page.goto(originalUrl)
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
  await expectPhoneSafeAreas(page, step)

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
  await expectSelectSheet(page, step)
  await selectors.phoneBack(page).click()
  await selectors.phoneLevel(page, 'sessions').waitFor()

  await selectors.sessionByTitle(page, SESSIONS[0]!).click()
  await selectors.phoneLevel(page, 'session').waitFor()
  await sendPrompt(page, 'Why did the upload give up?')
  await page.getByText(REPLY).first().waitFor({ timeout: 30_000 })
  await expectFits(page)
  await step('session')

  // The chat commands with no control of their own are one palette away.
  await selectors.phoneHeaderAction(page, 'Command palette').click()
  await selectors.paletteInput(page).waitFor()
  await step('palette-from-header')
  await page.keyboard.press('Escape')
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })

  await selectors.modelPickerTrigger(page).click()
  await selectors.modelPickerPanel(page).waitFor()
  await expectSheet(page, selectors.modelPickerPanel(page))
  await expectFocusStaysInSheet(page)
  await step('model-picker-sheet')
  // A tap on the scrim puts the sheet away, as on any phone.
  await page.touchscreen.tap(page.viewportSize()!.width / 2, 120)
  await selectors.modelPickerPanel(page).waitFor({ state: 'hidden' })

  // The system Back gesture closes the sheet and leaves the screen under it.
  await selectors.modelPickerTrigger(page).click()
  await selectors.modelPickerPanel(page).waitFor()
  await page.goBack()
  await selectors.modelPickerPanel(page).waitFor({ state: 'hidden' })
  await page.waitForTimeout(300)
  ok(await selectors.phoneLevel(page, 'session').isVisible(), 'Back closed only the sheet')

  await expectSheetStillMovesNot(page)
  await step('reduced-motion-sheet')
  await expectSheetAboveKeyboard(page, step)

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
  await expectDiffTintAtScreenEdge(page, 'addition')
  await expectDiffTintAtScreenEdge(page, 'deletion')
  equal(addressTabs(page).length, 1, 'The diff opens one editor tab')
  await step('diff')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await expectDiffTintAtScreenEdge(page, 'addition')
  await expectDiffTintAtScreenEdge(page, 'deletion')
  await step('diff-dark')
  await page.emulateMedia({ colorScheme: null })

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
  const keys = page.getByRole('toolbar', { name: 'Terminal keys' })
  const positiveStart = terminalInput().length
  await keys.getByRole('button', { name: 'Up' }).click()
  await keys.getByRole('button', { name: 'Esc' }).click()
  await expectTerminalSent(terminalInput, positiveStart, '\x1b[A\x1b')
  const sentBefore = terminalInput().length
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

/** Tab walks the sheet's own controls and never reaches the page behind the scrim. */
async function expectFocusStaysInSheet(page: Page) {
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press('Tab')
    // Tabbing past the last control lands on a focus guard, which hands focus back a frame later.
    const inside = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const active = document.activeElement
      if (active?.closest('[data-presentation="sheet"]')) return null
      return active ? active.outerHTML.slice(0, 200) : 'nothing'
    })
    ok(inside === null, `Focus left the sheet after ${press + 1} Tab presses: ${inside}`)
  }
}

/** Under Reduce Motion the sheet only fades: no frame of its rise moves it. */
async function expectSheetStillMovesNot(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  try {
    await selectors.modelPickerTrigger(page).click()
    const offsets = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const seen: number[] = []
          const sample = () => {
            const sheet = document.querySelector('[data-presentation="sheet"]')
            if (sheet) {
              const style = getComputedStyle(sheet)
              // The flat feel moves by keyframed transform, the physical feel by `translate`.
              const translateY =
                style.translate === 'none' ? 0 : parseFloat(style.translate.split(' ')[1] ?? '0')
              seen.push(new DOMMatrix(style.transform).m42 + translateY)
            }
            if (seen.length >= 8) return resolve(seen)
            requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }),
    )
    ok(
      offsets.every((offset) => Math.abs(offset) < 0.5),
      `The sheet moved under reduced motion: ${offsets.join(', ')}`,
    )
  } finally {
    await page.emulateMedia({ reducedMotion: null })
  }
}

/**
 * With the iOS keyboard up (its height stands in as the inset the shell measures), the sheet fits
 * what is left and its search field stays on screen: an iPhone SE upright, then any phone on its side.
 */
async function expectSheetAboveKeyboard(page: Page, step: (label: string) => Promise<void>) {
  const original = page.viewportSize()!
  const cases = [
    { label: 'keyboard-se', width: 375, height: 667, keyboard: 300 },
    { label: 'keyboard-landscape', width: 667, height: 375, keyboard: 200 },
  ]
  try {
    for (const { label, width, height, keyboard } of cases) {
      if (await selectors.modelPickerPanel(page).isVisible()) {
        await page.keyboard.press('Escape')
        await selectors.modelPickerPanel(page).waitFor({ state: 'hidden' })
      }
      await page.setViewportSize({ width, height })
      // The shell measures the keyboard on every visual-viewport resize; let this one land first.
      await page.waitForFunction((wide) => window.innerWidth === wide, width)
      await page.waitForTimeout(300)
      await page.evaluate(
        (inset) => document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`),
        keyboard,
      )
      await selectors.modelPickerTrigger(page).click()
      await selectors.modelPickerPanel(page).waitFor()
      await page.waitForTimeout(400)
      const search = await selectors.modelPickerSearch(page).boundingBox()
      const sheet = await selectors.modelPickerPanel(page).boundingBox()
      ok(search && sheet, 'The sheet and its search field must be laid out')
      ok(search.y >= 0, `The search field is above the screen: ${JSON.stringify(search)}`)
      ok(
        sheet.y + sheet.height <= height - keyboard + 1 &&
          search.y + search.height <= height - keyboard,
        `The sheet reaches under the keyboard: ${JSON.stringify({ sheet, search })}`,
      )
      await step(label)
    }
  } finally {
    await page.keyboard.press('Escape')
    await selectors.modelPickerPanel(page).waitFor({ state: 'hidden' })
    await page.evaluate(() => document.documentElement.style.setProperty('--keyboard-inset', '0px'))
    await page.setViewportSize(original)
  }
}

/** A Select on the settings screen opens as a sheet; Escape closes it and gives focus back. */
async function expectSelectSheet(page: Page, step: (label: string) => Promise<void>) {
  await selectors.settingsSearch(page).fill('Session notifications')
  const trigger = page.locator('[data-phone-shell] [data-slot="select-trigger"]').first()
  await trigger.click()
  const list = page.locator('[data-slot="select-content"]')
  await expectSheet(page, list)
  await step('select-sheet')
  await page.keyboard.press('Escape')
  await list.waitFor({ state: 'hidden' })
  ok(
    await trigger.evaluate((element) => element === document.activeElement),
    'Escape gives focus back to the Select',
  )
  await selectors.settingsSearch(page).fill('')
}

/**
 * A changed row's tint runs from the screen edge to its text, while the line numbers keep the
 * phone's gutter inset and show all three digits.
 */
async function expectDiffTintAtScreenEdge(page: Page, type: 'addition' | 'deletion') {
  const band = selectors.phoneDiffBand(page, type).first()
  await band.waitFor({ timeout: 20_000 })
  const row = await band.evaluate((gutterRow) => {
    const index = gutterRow.getAttribute('data-editor-virtual-gutter-row')
    const scroller = gutterRow.closest('.editor-virtualized')
    const text = scroller?.querySelector(`[data-editor-virtual-row="${index}"]`)
    const lane = gutterRow.querySelector('.editor-diff-gutter-lane')
    return {
      left: gutterRow.getBoundingClientRect().left,
      right: gutterRow.getBoundingClientRect().right,
      tint: getComputedStyle(gutterRow).backgroundColor,
      textLeft: text?.getBoundingClientRect().left ?? null,
      textTint: text ? getComputedStyle(text).backgroundColor : null,
      laneLeft: lane?.getBoundingClientRect().left ?? null,
    }
  })
  ok(row.left <= 0.5, `The tint starts at the screen edge: x=${row.left}`)
  equal(row.right, row.textLeft, 'The gutter tint meets the text row’s tint')
  ok(row.tint !== 'rgba(0, 0, 0, 0)', 'The gutter row carries the tint')
  equal(row.tint, row.textTint, 'The gutter and the text share one tint')
  ok(row.laneLeft !== null && row.laneLeft >= 8, `Line numbers keep the inset: x=${row.laneLeft}`)

  const numbers = await selectors.phoneDiffNumberLanes(page).evaluateAll((lanes) =>
    lanes.map((lane) => ({
      text: lane.textContent ?? '',
      clipped: lane.scrollWidth > lane.clientWidth,
    })),
  )
  ok(
    numbers.some((lane) => /^\d{3}$/.test(lane.text)),
    `The diff shows three-digit line numbers: ${JSON.stringify(numbers)}`,
  )
  const clipped = numbers.filter((lane) => lane.clipped)
  equal(clipped.length, 0, `No line number is clipped: ${JSON.stringify(clipped)}`)
}

/** The notes file, long enough that its change sits on a three-digit line. */
function notesWith(line: string) {
  const filler = Array.from({ length: 118 }, (_, index) => `Note ${index + 1}.`)
  return ['# Notes'].concat(filler.slice(0, 108), [line], filler.slice(108))
}

/** The editor tabs the address records: one token per open tab. */
function addressTabs(page: Page) {
  const tabs = new URL(page.url()).searchParams.get('tabs')
  if (tabs === null || tabs === '-') return []
  return tabs.split('~')
}

/** A finger dragged up the list scrolls it, and reorders nothing. */
async function expectListScrollsUnderAFinger(page: Page) {
  // WebKit's driver cannot send a native touch drag; Chromium covers scrolling without reordering.
  if (page.context().browser()?.browserType().name() !== 'chromium') return
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
  await scrollSettled(list)
  ok((await list.evaluate((element) => element.scrollTop)) > 0, 'The list scrolled')
  equal((await order()).join('|'), before.join('|'), 'The drag reordered nothing')
  await list.evaluate((element) => element.scrollTo({ top: 0 }))
  // The next step long-presses a row, and a scroll event arriving after the touch cancels it.
  await scrollSettled(list)
}

/** The fling has stopped and its last scroll event is dispatched: three frames without movement. */
function scrollSettled(list: Locator) {
  return list.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let last = element.scrollTop
        let still = 0
        const check = () => {
          still = element.scrollTop === last ? still + 1 : 0
          last = element.scrollTop
          if (still >= 3) return resolve()
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }),
  )
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
  await new Promise((resolve) => setTimeout(resolve, 100))
  equal(sent().slice(from), expected, 'Each key sends its bytes once')
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
