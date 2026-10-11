import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { readClipboard } from '../clipboard'
import {
  createModifiedFileFixture,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openFileByName, selectors, textPoint } from '../selectors'

const TEXT = ['alpha bravo charlie', 'second line', 'third row']

export const editorTouchSelection: Scenario = {
  name: 'editor-touch-selection',
  description:
    'Hold, triple-tap and quadruple-tap text in the app editor and copy through its optional touch menu.',
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture('touch-selection', 'a.txt', TEXT, TEXT)
    try {
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'a.txt')
      await selectors.editorInput(page).first().waitFor({ state: 'visible' })
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      const point = await textPoint(page, 'alpha bravo charlie', 'bravo')
      await finger(page, 'touchstart', point)
      await page.waitForTimeout(600)
      await finger(page, 'touchend', point)
      await selectors.editorTouchMenu(page).waitFor({ state: 'visible' })
      await step('held-word-menu')
      await copySelection(page, 'bravo')
      for (const count of [3, 4]) {
        for (let tap = 0; tap < count; tap++) {
          await finger(page, 'touchstart', point)
          await finger(page, 'touchend', point)
        }
        await selectors.editorTouchMenu(page).waitFor({ state: 'visible' })
        await step(count === 3 ? 'triple-line-menu' : 'quad-document-menu')
        await copySelection(page, count === 3 ? TEXT[0]! : `${TEXT.join('\n')}\n`)
      }
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function copySelection(page: Page, text: string): Promise<void> {
  await selectors.editorTouchAction(page, 'Copy').click()
  await selectors.editorTouchMenu(page).waitFor({ state: 'hidden' })
  strictEqual(await readClipboard(page), text)
}

async function finger(
  page: Page,
  type: 'touchstart' | 'touchend',
  point: { x: number; y: number },
): Promise<void> {
  await selectors.editorTouchSurface(page).first().evaluate(`(element) => {
    const touch = { identifier: 1, target: element, clientX: ${point.x}, clientY: ${point.y} }
    const event = new Event(${JSON.stringify(type)}, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      touches: { value: ${type === 'touchend' ? '[]' : '[touch]'} },
      targetTouches: { value: ${type === 'touchend' ? '[]' : '[touch]'} },
      changedTouches: { value: [touch] },
    })
    element.dispatchEvent(event)
  }`)
}
