import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, runPaletteCommand } from '../selectors'
import type { Scenario } from './index'

const README = [
  '# Clobber',
  '',
  '<img name="getSelection" src="x.png" alt="x">',
  '',
  '<div id="main">raw id</div>',
  '',
  'Text.',
  '',
].join('\n')

export const markdownPreviewClobber: Scenario = {
  name: 'markdown-preview-clobber',
  description:
    'Previews a markdown file whose raw HTML names document properties, then types in its source: the document keeps getSelection and typing raises no page error.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-preview-clobber-')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await writeFile(path.join(fixture, 'readme.md'), README)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'readme.md')
      await runPaletteCommand(page, 'Cycle markdown view')
      await page.locator('[data-markdown-preview] h1').waitFor()
      await page.locator('[data-markdown-preview] img').waitFor({ state: 'attached' })
      await step('preview')
      const document = await page.evaluate(() => ({
        getSelection: typeof window.document.getSelection,
        imageName: window.document
          .querySelector('[data-markdown-preview] img')
          ?.getAttribute('name'),
        rawId: window.document.querySelector('[data-markdown-preview] [id$="main"]')?.id,
      }))
      deepStrictEqual(document, {
        getSelection: 'function',
        imageName: 'user-content-getSelection',
        rawId: 'user-content-main',
      })

      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.type('typed after preview', { delay: 20 })
      await page.keyboard.press('Shift+Home')
      await step('typed')
      strictEqual(errors.join('\n'), '')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
