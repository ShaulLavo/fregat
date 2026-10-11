import { expect, test, type Page } from '@playwright/test'
import type { EditorDisposable, EditorPlugin } from '../../../packages/editor/src/plugins'

type SelectionEditor = {
  addPlugin(plugin: EditorPlugin): EditorDisposable
  getSelections(): readonly { anchorOffset: number; headOffset: number }[]
  materializeFullText(): string
}
type TestWindow = Window & { touchEditor: SelectionEditor; touchPressCounts?: number[] }

async function installEditor(page: Page): Promise<void> {
  await page.goto('/test/fixtures/mobile-selection.html')
  await expect(page.locator('.editor-virtualized-row').first()).toContainText('alpha bravo charlie')
}

async function textPoint(page: Page, offset: number): Promise<{ x: number; y: number }> {
  return page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row, at) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode()!
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 1)
      const rect = range.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }, offset)
}

async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (window as TestWindow).touchEditor
    const selection = editor.getSelections()[0]!
    return editor
      .materializeFullText()
      .slice(
        Math.min(selection.anchorOffset, selection.headOffset),
        Math.max(selection.anchorOffset, selection.headOffset),
      )
  })
}

async function touch(page: Page, type: string, point: { x: number; y: number }): Promise<void> {
  await page.evaluate(
    ({ type, point }) => {
      const target = document.elementFromPoint(point.x, point.y)!
      // WebKit exposes Touch but refuses its constructor; injected holds test the controller,
      // while touchscreen taps and the native Safari proof exercise real platform gestures.
      const finger = { identifier: 0, target, clientX: point.x, clientY: point.y }
      const event = new Event(type, { bubbles: true, cancelable: true })
      const ended = type === 'touchend' || type === 'touchcancel'
      Object.defineProperties(event, {
        touches: { value: ended ? [] : [finger] },
        targetTouches: { value: ended ? [] : [finger] },
        changedTouches: { value: [finger] },
      })
      target.dispatchEvent(event)
    },
    { type, point },
  )
}

test.beforeEach(async ({ page }) => installEditor(page))

test('double-tap selects a word and a later tap collapses it', async ({ page }) => {
  const point = await textPoint(page, 8)
  await page.touchscreen.tap(point.x, point.y)
  const caret = await page.evaluate(() => (window as TestWindow).touchEditor.getSelections()[0]!)
  expect(caret.anchorOffset).toBe(caret.headOffset)
  expect(caret.headOffset).toBeGreaterThan(0)
  await page.waitForTimeout(80)
  await page.touchscreen.tap(point.x, point.y)
  await expect.poll(() => selectedText(page)).toBe('bravo')
  const elsewhere = await textPoint(page, 2)
  await page.waitForTimeout(500)
  await page.touchscreen.tap(elsewhere.x, elsewhere.y)
  await expect.poll(() => selectedText(page)).toBe('')
  await page.waitForTimeout(250)
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()
})

test('native mouse counts select words after a touch tap', async ({ page }) => {
  const point = await textPoint(page, 8)
  await page.touchscreen.tap(point.x, point.y)
  await page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row, point) => {
      row.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          detail: 2,
          clientX: point.x,
          clientY: point.y,
        }),
      )
    }, point)
  await expect.poll(() => selectedText(page)).toBe('bravo')
})

test('native double-click selects a word after a touch tap', async ({ page }) => {
  const point = await textPoint(page, 8)
  await page.touchscreen.tap(point.x, point.y)
  await page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row, point) => {
      row.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          detail: 2,
          clientX: point.x,
          clientY: point.y,
        }),
      )
    }, point)
  await expect.poll(() => selectedText(page)).toBe('bravo')
})

test('a cancelled native touch press keeps its caret on double-click', async ({ page }) => {
  const point = await textPoint(page, 8)
  await page.touchscreen.tap(point.x, point.y)
  await page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row, point) => {
      document.addEventListener('mousedown', (event) => event.preventDefault(), {
        capture: true,
        once: true,
      })
      for (const type of ['mousedown', 'dblclick']) {
        row.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            detail: 2,
            clientX: point.x,
            clientY: point.y,
          }),
        )
      }
    }, point)
  await expect.poll(() => selectedText(page)).toBe('')
})

test('a claimed native touch press runs its participant once', async ({ page }) => {
  const point = await textPoint(page, 8)
  await page.touchscreen.tap(point.x, point.y)
  await page.evaluate(() => {
    const state = window as TestWindow
    const counts: number[] = []
    state.touchPressCounts = counts
    state.touchEditor.addPlugin({
      activate: (context) =>
        context.registerViewContribution({
          createContribution: (view) => {
            const registration = view.registerPressParticipant((event) => {
              counts.push(event.detail)
              return true
            })
            return { update() {}, dispose: () => registration.dispose() }
          },
        }),
    })
  })
  await page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row, point) => {
      for (const type of ['mousedown', 'click', 'dblclick']) {
        row.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            detail: 2,
            clientX: point.x,
            clientY: point.y,
          }),
        )
      }
    }, point)
  expect(await page.evaluate(() => (window as TestWindow).touchPressCounts)).toEqual([2])
  await expect.poll(() => selectedText(page)).toBe('')
})

test('long-press selects a word and dragging extends the selection', async ({ page }, testInfo) => {
  const point = await textPoint(page, 8)
  await touch(page, 'touchstart', point)
  await page.waitForTimeout(700)
  await expect.poll(() => selectedText(page)).toBe('bravo')
  await touch(page, 'touchmove', await textPoint(page, 2))
  await expect.poll(() => selectedText(page)).toBe('alpha bravo')
  await touch(page, 'touchmove', await textPoint(page, 17))
  await touch(page, 'touchend', await textPoint(page, 17))
  await expect.poll(() => selectedText(page)).toBe('bravo charlie')
  await expect(page.locator('.editor-virtualized')).toHaveAttribute(
    'data-editor-touch-selection',
    '',
  )
  const paint = await page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row) => getComputedStyle(row, '::selection').backgroundColor)
  expect(paint).not.toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({ path: testInfo.outputPath('touch-word-drag.png') })
})

test('a swipe and a cancelled gesture never start word selection', async ({ page }) => {
  const point = await textPoint(page, 8)
  await touch(page, 'touchstart', point)
  await touch(page, 'touchmove', { x: point.x, y: point.y + 40 })
  await page.waitForTimeout(700)
  await touch(page, 'touchend', { x: point.x, y: point.y + 40 })
  await expect.poll(() => selectedText(page)).toBe('')
  await touch(page, 'touchstart', point)
  await touch(page, 'touchcancel', point)
  await page.waitForTimeout(700)
  await expect.poll(() => selectedText(page)).toBe('')
})

test('browser DOM selection changes settle the session and copy payload', async ({ page }) => {
  const point = await textPoint(page, 8)
  await touch(page, 'touchstart', point)
  await page.waitForTimeout(700)
  await touch(page, 'touchend', point)
  await page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row) => {
      const text = document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode()!
      document.getSelection()!.setBaseAndExtent(text, 19, text, 6)
    })
  await expect.poll(() => selectedText(page)).toBe('bravo charlie')
  const copied = await page.locator('.editor-virtualized').evaluate((element) => {
    const clipboardData = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }),
    )
    return clipboardData.getData('text/plain')
  })
  expect(copied).toBe('bravo charlie')
})

test('native selection takes ownership of an active hold', async ({ page }) => {
  const point = await textPoint(page, 8)
  await touch(page, 'touchstart', point)
  await page
    .locator('.editor-virtualized-row')
    .first()
    .evaluate((row) => {
      const text = document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode()!
      document.getSelection()!.setBaseAndExtent(text, 12, text, 19)
    })
  await expect.poll(() => selectedText(page)).toBe('charlie')
  await page.waitForTimeout(750)
  await touch(page, 'touchend', point)
  await expect.poll(() => selectedText(page)).toBe('charlie')
  await page.locator('#native-selection-control').evaluate((control) => {
    const range = document.createRange()
    range.selectNodeContents(control)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  })
  await expect.poll(() => selectedText(page)).toBe('charlie')
})

test('a mouse still selects words after using touch', async ({ page }) => {
  const point = await textPoint(page, 8)
  await page.touchscreen.tap(point.x, point.y)
  const other = await textPoint(page, 2)
  await page.mouse.dblclick(other.x, other.y)
  await expect.poll(() => selectedText(page)).toBe('alpha')
})
