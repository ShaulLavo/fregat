import type { Page } from 'playwright'
import { ok } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const KEY_DELAYS_MS = [250, 90, 30]

type Flow = {
  readonly name: string
  type(page: Page, delay: number): Promise<void>
}

const FLOWS: readonly Flow[] = [
  { name: 'straight', type: (page, delay) => page.keyboard.type('console.l', { delay }) },
  {
    name: 'paused-after-c',
    async type(page, delay) {
      await page.keyboard.type('c', { delay })
      await page.waitForTimeout(1200)
      await page.keyboard.type('onsole.l', { delay })
    },
  },
  {
    name: 'accepted',
    async type(page, delay) {
      await page.keyboard.type('conso', { delay })
      await page.waitForTimeout(1200)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
      await page.keyboard.type('.l', { delay })
    },
  },
]

export const editorLspCompletion: Scenario = {
  name: 'editor-lsp-completion',
  description:
    'Reach console.l three ways at three typing speeds and check the list holds members, not globals.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    // Line two, so an Astro file is typed into inside its frontmatter fence.
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('End')
    await page.keyboard.insertText('\n')
    await page.waitForTimeout(2500)
    for (const flow of FLOWS) {
      for (const delay of KEY_DELAYS_MS) await checkFlow(page, flow, delay, step)
    }
    await page.keyboard.press('Control+z')
    await step('restored')
  },
}

async function checkFlow(
  page: Page,
  flow: Flow,
  delay: number,
  step: (name: string) => Promise<void>,
) {
  await flow.type(page, delay)
  await page.waitForTimeout(1200)
  const labels = await selectors.editorCompletionLabels(page)
  const label = `${flow.name} at ${delay}ms`
  console.log(`${label}: ${labels.slice(0, 8).join(', ')}`)
  await step(`${flow.name}-${delay}ms`)
  ok(labels.includes('log'), `${label} offers log`)
  ok(!labels.includes('localStorage'), `${label} offers no globals`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('Backspace')
}
