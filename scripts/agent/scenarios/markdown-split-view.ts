import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

// A 1×1 PNG, so the rendered image has something real to load.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function guide() {
  const fence = Array.from({ length: 100 }, (_, index) => `const line${index + 1} = ${index + 1}`)
  return [
    '# Guide',
    '',
    'See [the other file](other.md) and the pixel ![pixel](img/pixel.png).',
    '',
    '```ts',
    ...fence,
    '```',
    '',
    '## After the fence',
    '',
    'The end.',
    '',
  ].join('\n')
}

function preview(page: Page) {
  return page.locator('[data-markdown-preview] .app-scrollbar-thin').first()
}

export const markdownSplitView: Scenario = {
  name: 'markdown-split-view',
  description:
    'Cycle a markdown file to source beside a rendered view: headings render, scrolling either side follows the other through a 100-line fence, workspace links open and images load; cycling on returns to source only.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-markdown-split-')
    try {
      await writeFile(path.join(fixture, 'guide.md'), guide())
      await writeFile(path.join(fixture, 'other.md'), '# Other\n')
      await mkdir(path.join(fixture, 'img'))
      await writeFile(path.join(fixture, 'img', 'pixel.png'), PIXEL)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'guide.md')

      await runPaletteCommand(page, 'Cycle markdown view')
      await preview(page).getByRole('heading', { name: 'Guide', level: 1 }).waitFor()
      await page
        .locator('[data-markdown-preview] img')
        .evaluate((image: HTMLImageElement) =>
          image.complete && image.naturalWidth > 0
            ? true
            : new Promise((resolve) => image.addEventListener('load', () => resolve(true))),
        )
      await step('split-view')

      // Editor → preview: the source scrolled into the fence puts the fence at the preview's top.
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('PageDown')
      await page.keyboard.press('PageDown')
      await page.waitForTimeout(500)
      const inFence = await preview(page).evaluate((container) => {
        const fence = container.querySelector('pre')!.getBoundingClientRect()
        const top = container.getBoundingClientRect().top
        return fence.top < top && fence.bottom > top
      })
      ok(inFence, 'Scrolling the source into the fence scrolls the preview into the fence')
      await step('editor-drives-preview')

      // Preview → editor: the "After the fence" heading at the top brings its source line up.
      await preview(page).evaluate((container) => {
        const heading = [...container.querySelectorAll('h2')].at(-1)!
        container.scrollTop +=
          heading.getBoundingClientRect().top - container.getBoundingClientRect().top
      })
      await page.waitForTimeout(400)
      // "## After the fence" is source line 108: its row sits at the top, or the editor is at its end.
      const editor = await selectors
        .editorSurface(page)
        .first()
        .evaluate((element) => {
          const row = Number.parseFloat(
            getComputedStyle(element).getPropertyValue('--editor-row-height'),
          )
          return { max: element.scrollHeight - element.clientHeight, row, top: element.scrollTop }
        })
      const expected = Math.min(107 * editor.row, editor.max)
      ok(
        Math.abs(editor.top - expected) <= 2 * editor.row,
        `Preview scroll put the editor at ${editor.top}px, expected about ${expected}px`,
      )
      await step('preview-drives-editor')

      await preview(page).getByRole('link', { name: 'the other file' }).click()
      await selectors.editorTab(page, path.join(fixture, 'other.md').slice(1)).waitFor()
      await step('link-opens-file')

      await selectors.editorTab(page, path.join(fixture, 'guide.md').slice(1)).click()
      await runPaletteCommand(page, 'Cycle markdown view')
      await page.locator('[data-markdown-preview]').waitFor({ state: 'detached' })
      strictEqual(await page.locator('[data-markdown-preview]').count(), 0)
      await step('source-only')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
