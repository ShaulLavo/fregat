import type { Editor, EditorPlugin } from '@singapore-editor/core'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/test/fixtures/mobile-custom-selection.html')
  await expect(page.locator('#state')).toContainText('session')
})

// WebKit has no portable finger-drag API in Playwright. The simulator proof uses OS gestures.
async function finger(page: Page, type: string, x: number, y: number) {
  await page.locator('.editor-virtualized').evaluate(
    (element, args) => {
      const touch = { identifier: 1, target: element, clientX: args.x, clientY: args.y }
      const event = new Event(args.type, { bubbles: true, cancelable: true })
      const ended = args.type === 'touchend' || args.type === 'touchcancel'
      Object.defineProperties(event, {
        touches: { value: ended ? [] : [touch] },
        targetTouches: { value: ended ? [] : [touch] },
        changedTouches: { value: [touch] },
      })
      element.dispatchEvent(event)
    },
    { type, x, y },
  )
}

async function textPoint(page: Page, row: number, offset: number) {
  return page
    .locator('.editor-virtualized-row')
    .nth(row)
    .evaluate((element, at) => {
      const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + 1)
      const rect = range.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }, offset)
}

async function beginHold(page: Page) {
  const point = await textPoint(page, 0, 8)
  await finger(page, 'touchstart', point.x, point.y)
  await page.waitForTimeout(575)
  await expect(page.locator('#selection')).toHaveText('Selected: bravo')
  return point
}

test('touch claims native row selection immediately and restores selectable text on release', async ({
  page,
}) => {
  const point = await textPoint(page, 0, 8)
  await finger(page, 'touchstart', point.x, point.y)
  const row = page.locator('.editor-virtualized-row').first()
  await expect
    .poll(() => row.evaluate((element) => getComputedStyle(element).userSelect))
    .toBe('none')
  await expect(page.locator('#selection')).toHaveText('Selected: bravo')
  await expect(page.locator('.editor-virtualized-selection-range').first()).toBeVisible()
  await expect(page.locator('#native-state')).toHaveText('Native row selections: 0')
  await finger(page, 'touchend', point.x, point.y)
  await expect
    .poll(() => row.evaluate((element) => getComputedStyle(element).userSelect))
    .toBe('text')
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await expect(page.locator('#native-state')).toHaveText('Native row selections: 0')
})

test('holding and dragging advances across rows, then typing replaces selection', async ({
  page,
}) => {
  await beginHold(page)
  const last = await textPoint(page, 2, 7)
  await finger(page, 'touchmove', last.x, last.y + 12)
  await finger(page, 'touchend', last.x, last.y + 12)
  await expect(page.locator('#selection')).toHaveText(
    'Selected: bravo charlie\nsecond line\nthird row',
  )
  await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('custom-row-selection.png') })
  await page.locator('textarea').press('x')
  await expect(page.locator('#host')).toContainText('alpha x')
  await expect(page.getByRole('toolbar')).toHaveCount(0)
})

test('double tap selects a word and menu actions extend through the public option', async ({
  page,
}) => {
  const point = await textPoint(page, 0, 8)
  await page.touchscreen.tap(point.x, point.y)
  await page.touchscreen.tap(point.x, point.y)
  await expect(page.locator('#selection')).toHaveText('Selected: bravo')
  await page.getByRole('button', { name: 'Demo: count characters', exact: true }).click()
  await expect(page.locator('#status')).toContainText('5 characters')
  await page.locator('#reset').click()
  await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(page.locator('#selection')).toHaveText(
    'Selected: alpha bravo charlie\nsecond line\nthird row',
  )
})

test('triple tap selects the same whole line as desktop triple click', async ({ page }) => {
  const point = await textPoint(page, 0, 8)
  for (let tap = 0; tap < 3; tap++) {
    await finger(page, 'touchstart', point.x, point.y)
    await finger(page, 'touchend', point.x, point.y)
  }
  await expect(page.locator('#selection')).toHaveText('Selected: alpha bravo charlie')
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
})

test('quad tap selects the full document like desktop quad click', async ({ page }) => {
  const point = await textPoint(page, 0, 8)
  for (let tap = 0; tap < 4; tap++) {
    await finger(page, 'touchstart', point.x, point.y)
    await finger(page, 'touchend', point.x, point.y)
  }
  await expect(page.locator('#selection')).toHaveText(
    'Selected: alpha bravo charlie\nsecond line\nthird row',
  )
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
})

test('third tap drag extends by whole lines in both directions', async ({ page }) => {
  const point = await textPoint(page, 1, 4)
  for (let tap = 0; tap < 2; tap++) {
    await finger(page, 'touchstart', point.x, point.y)
    await finger(page, 'touchend', point.x, point.y)
  }
  await finger(page, 'touchstart', point.x, point.y)
  await expect(page.locator('#selection')).toHaveText('Selected: second line')
  const first = await textPoint(page, 0, 8)
  await finger(page, 'touchmove', first.x, first.y + 12)
  await expect(page.locator('#selection')).toHaveText('Selected: alpha bravo charlie\nsecond line')
  const last = await textPoint(page, 2, 2)
  await finger(page, 'touchmove', last.x, last.y + 12)
  await finger(page, 'touchend', last.x, last.y + 12)
  await expect(page.locator('#selection')).toHaveText('Selected: second line\nthird row')
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
})

test('touch Undo and Redo appear only when available and use editor history', async ({ page }) => {
  let point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toHaveCount(0)
  await page.locator('textarea').press('ArrowLeft')
  await page.locator('textarea').press('Home')
  await page.locator('textarea').press('x')
  point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('#host')).toContainText('alpha bravo charlie')
  point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('#host')).toContainText('xalpha bravo charlie')
  point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toHaveCount(0)
})

test('core alone keeps touch semantics after optional chrome is removed', async ({ page }) => {
  await page.evaluate(() => {
    const windowWithPlugin = window as TouchFixtureWindow
    windowWithPlugin.touchEditor.removePlugin(windowWithPlugin.touchMenuPlugin)
  })
  const point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await page.waitForTimeout(100)
  await expect(page.locator('#selection')).toHaveText('Selected: bravo')
  await expect(page.getByRole('toolbar')).toHaveCount(0)
  await expect(page.locator('style[data-editor-touch-menu]')).toHaveCount(0)
  await page.evaluate(() => {
    const windowWithPlugin = window as TouchFixtureWindow
    windowWithPlugin.touchEditor.addPlugin(windowWithPlugin.touchMenuPlugin)
  })
  await expect(page.locator('style[data-editor-touch-menu]')).toHaveCount(1)
  await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
})

test('trusted menu switch activation keeps actions, typing focus and button accessibility', async ({
  page,
}) => {
  const switchSupported = await page.evaluate(
    () => 'switch' in document.createElement('input') && !navigator.vibrate,
  )
  test.skip(!switchSupported, 'This browser has no native switch haptic path.')
  await page.evaluate(() => {
    const observed = window as TouchFixtureWindow
    observed.hapticClicks = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          observed.clipboardWritten = text
        },
      },
    })
    document.addEventListener('click', (event) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.matches('.editor-touch-menu input[switch]'))
        observed.hapticClicks.push(event.isTrusted)
    })
  })
  const point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  const copy = page.getByRole('button', { name: 'Copy', exact: true })
  await expect(copy).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(1)
  const bounds = (await copy.boundingBox())!
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect
    .poll(() => page.evaluate(() => (window as TouchFixtureWindow).clipboardWritten))
    .toBe('bravo')
  expect(await page.evaluate(() => (window as TouchFixtureWindow).hapticClicks)).toEqual([true])
  expect(
    await page.evaluate(() => document.activeElement === document.querySelector('textarea')),
  ).toBe(true)
})

test('release restores the selected input window after focus collapses its native range', async ({
  page,
}) => {
  await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => {
    input.blur()
    input.addEventListener(
      'focus',
      () => {
        input.setSelectionRange(0, 0)
        input.dispatchEvent(new Event('select', { bubbles: true }))
      },
      { once: true },
    )
  })
  const point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await expect(page.locator('#selection')).toHaveText('Selected: bravo')
  await expect
    .poll(() =>
      page
        .locator('textarea')
        .evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd]),
    )
    .toEqual([6, 11])
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
})

test('delayed native focus restores the session range before selection events', async ({
  page,
}) => {
  const point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => {
    input.setSelectionRange(0, 0)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    input.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await expect(page.locator('#selection')).toHaveText('Selected: bravo')
  await expect
    .poll(() =>
      page
        .locator('textarea')
        .evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd]),
    )
    .toEqual([6, 11])
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
})

test('Select all keeps actions and refreshes their selection context', async ({ page }) => {
  const point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Demo: count characters', exact: true }).click()
  await expect(page.locator('#status')).toContainText('41 characters')
})

test('keyboard and host selection changes dismiss the touch menu', async ({ page }) => {
  const point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await page.locator('textarea').press('ArrowLeft')
  await expect(page.getByRole('toolbar')).toHaveCount(0)
  await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await page.evaluate(() => (window as TouchFixtureWindow).touchEditor.setSelection(0))
  await expect(page.getByRole('toolbar')).toHaveCount(0)
})

test('release after edge scrolling preserves the menu until a later scroll', async ({ page }) => {
  await page.locator('#long').click()
  await beginHold(page)
  const bounds = (await page.locator('#host').boundingBox())!
  const x = bounds.x + 160
  const y = bounds.y + bounds.height - 2
  await finger(page, 'touchmove', x, y)
  const scroller = page.locator('.editor-virtualized')
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  await finger(page, 'touchend', x, y)
  await page.waitForTimeout(150)
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await scroller.evaluate((el) => {
    el.scrollTop += 24
  })
  await expect(page.getByRole('toolbar')).toHaveCount(0)
})

test('the second tap can drag backward from a word across a row', async ({ page }) => {
  const point = await textPoint(page, 1, 4)
  await finger(page, 'touchstart', point.x, point.y)
  await finger(page, 'touchend', point.x, point.y)
  await finger(page, 'touchstart', point.x, point.y)
  await expect(page.locator('#selection')).toHaveText('Selected: second')
  const first = await textPoint(page, 0, 1)
  await finger(page, 'touchmove', first.x, first.y + 12)
  await finger(page, 'touchend', first.x, first.y + 12)
  await expect(page.locator('#selection')).toHaveText('Selected: alpha bravo charlie\nsecond')
})

test('dragging at the edge scrolls wrapped virtual rows and cancellation stops it', async ({
  page,
}) => {
  await page.locator('#long').click()
  await page.locator('#wrap').check()
  await beginHold(page)
  const bounds = (await page.locator('#host').boundingBox())!
  const y = bounds.y + bounds.height - 2
  await finger(page, 'touchmove', bounds.x + 160, y)
  const scroller = page.locator('.editor-virtualized')
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  await finger(page, 'touchcancel', bounds.x + 160, y)
  const stopped = await scroller.evaluate((el) => el.scrollTop)
  await page.waitForTimeout(150)
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(stopped)
  await expect(page.getByRole('toolbar')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('custom-edge-scroll.png') })
})

test('a swipe cancels selection recognition before its hold deadline', async ({ page }) => {
  const point = await textPoint(page, 0, 8)
  await finger(page, 'touchstart', point.x, point.y)
  await finger(page, 'touchmove', point.x, point.y + 40)
  await page.waitForTimeout(700)
  await finger(page, 'touchend', point.x, point.y + 40)
  await expect(page.locator('#selection')).toHaveText('Selected: ')
  await expect(page.getByRole('toolbar')).toHaveCount(0)
})

type TouchFixtureWindow = Window & {
  touchEditor: Pick<Editor, 'setSelection' | 'materializeFullText' | 'removePlugin' | 'addPlugin'>
  touchMenuPlugin: EditorPlugin
  hapticClicks: boolean[]
  clipboardWritten?: string
  finishClipboardRead?: (text: string) => void
}

test('Copy, Cut and Paste use the selected document text', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          ;(window as TouchFixtureWindow).clipboardWritten = text
        },
        readText: async () => 'replacement',
      },
    })
  })
  for (const action of ['Copy', 'Cut', 'Paste']) {
    await page.locator('#reset').click()
    const point = await beginHold(page)
    await finger(page, 'touchend', point.x, point.y)
    await page.getByRole('button', { name: action, exact: true }).click()
    if (action === 'Paste')
      await expect(page.locator('#host')).toContainText('alpha replacement charlie')
    else
      expect(await page.evaluate(() => (window as TouchFixtureWindow).clipboardWritten)).toBe(
        'bravo',
      )
    if (action === 'Cut') await expect(page.locator('#host')).toContainText('alpha  charlie')
  }
})

test('an asynchronous paste keeps a later selection unchanged', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () =>
          new Promise<string>((resolve) => {
            ;(window as TouchFixtureWindow).finishClipboardRead = resolve
          }),
      },
    })
  })
  const point = await beginHold(page)
  await finger(page, 'touchend', point.x, point.y)
  await page.getByRole('button', { name: 'Paste', exact: true }).click()
  await expect(page.getByRole('toolbar')).toHaveAttribute('aria-busy', 'true')
  await page.evaluate(() => {
    const state = window as TouchFixtureWindow
    state.touchEditor.setSelection(0)
    state.finishClipboardRead!('stale paste')
  })
  await expect(page.getByRole('toolbar')).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as TouchFixtureWindow).touchEditor.materializeFullText()),
  ).toBe('alpha bravo charlie\nsecond line\nthird row')
  await expect(page.locator('#selection')).toHaveText('Selected: ')
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the ${colorScheme} touch menu fits a narrow viewport below a top-row selection`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.emulateMedia({ colorScheme })
    const point = await beginHold(page)
    await finger(page, 'touchend', point.x, point.y)
    const menu = page.getByRole('toolbar', { name: 'Selection actions' })
    await expect(menu).toHaveAttribute('data-side', 'bottom')
    const bounds = (await menu.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(8)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(312)
    expect(bounds.y).toBeGreaterThan(point.y + 12)
    await expect(menu).toHaveCSS(
      'background-color',
      colorScheme === 'dark' ? 'rgb(48, 48, 51)' : 'rgb(248, 248, 250)',
    )
    await page.screenshot({ path: test.info().outputPath(`custom-menu-${colorScheme}.png`) })
  })
}
