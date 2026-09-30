import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import type { Page } from 'playwright'
import { readClipboard } from '../clipboard'
import { focusEditor, openFileByName, selectors } from '../selectors'

type BurstProof = { initial: string; typed: string; restored: string; undoCount: number }
const inspections = new WeakMap<Page, BurstProof>()

const TEXT = 'function burst() { return [1, 2, 3].map((n) => n * 2) }\n'

export const editorTypeBurst: Scenario = {
  name: 'editor-type-burst',
  description: `Open a file and type ${TEXT.length * 5} characters at 5ms per key, then verify Undo restores the original text.`,
  inspect: async (page) => inspections.get(page),
  run: typeEditorBurst,
}

export async function typeEditorBurst(
  page: Page,
  { file, step }: Pick<Parameters<Scenario['run']>[1], 'file' | 'step'>,
) {
  await openFileByName(page, file)
  await step('opened')
  await focusEditor(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const initial = await copiedText(page)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 5; i++) await page.keyboard.type(TEXT, { delay: 5 })
  const typed = await copiedText(page)
  inspections.set(page, { initial, typed, restored: typed, undoCount: 0 })
  strictEqual(
    typed,
    `${initial}\n${TEXT.repeat(5)}`,
    'Typing preserves every character without extra closing delimiters',
  )
  await step('typed')
  let actual = typed
  let undoCount = 0
  for (let i = 0; actual !== initial && i <= TEXT.length * 5; i++) {
    await page.keyboard.press('Control+z')
    actual = await copiedText(page)
    undoCount += 1
  }
  inspections.set(page, { initial, typed, restored: actual, undoCount })
  strictEqual(actual, initial, 'Undo restores the complete original document')
  await page.keyboard.press('Control+Home')
  await selectors
    .editorSurface(page)
    .first()
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
  await step('undone')
}

async function copiedText(page: Page) {
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  return readClipboard(page)
}
