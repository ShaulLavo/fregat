import { scratchPath } from '../paths'
import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import {
  chords,
  focusEditor,
  openFileFromTree,
  pressShortcut,
  runPaletteCommand,
  selectors,
} from '../selectors'
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
  ]
    .concat(
      fence,
      ['```', '', '## After the fence', ''], // Enough tail that both panes can scroll the heading to their top.
      Array.from({ length: 40 }, (_, index) => `Closing paragraph ${index + 1}.\n`),
    )
    .join('\n')
}

function preview(page: Page) {
  return page.locator('[data-markdown-preview] .app-scrollbar-thin').first()
}

export const markdownSplitView: Scenario = {
  name: 'markdown-split-view',
  description:
    'Open a rendered pane beside Markdown editing: headings render, the page has no bar or background of its own, the divider resizes it, scrolling either side follows the other through a 100-line fence, workspace links open and images load; closing the pane preserves the editor, and the rendered-only view hides the editor.',
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-markdown-split-'))
    try {
      await writeFile(path.join(fixture, 'guide.md'), guide())
      await writeFile(path.join(fixture, 'other.md'), '# Other\n')
      await mkdir(path.join(fixture, 'img'))
      await writeFile(path.join(fixture, 'img', 'pixel.png'), PIXEL)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'guide.md')

      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await preview(page).getByRole('heading', { name: 'Guide', level: 1 }).waitFor()
      await page
        .locator('[data-markdown-preview] img')
        .evaluate((image: HTMLImageElement) =>
          image.complete && image.naturalWidth > 0
            ? true
            : new Promise((resolve) => image.addEventListener('load', () => resolve(true))),
        )
      await step('split-view')

      // The page sits on the app's background with no bar of its own.
      const pane = page.locator('[data-markdown-preview]')
      strictEqual(await pane.getByText('Preview', { exact: true }).count(), 0, 'no Preview label')
      strictEqual(
        await pane.evaluate((element) => getComputedStyle(element).backgroundColor),
        'rgba(0, 0, 0, 0)',
        'the page has no background of its own',
      )

      // Dragging the divider resizes both sides.
      const before = (await pane.boundingBox())!.width
      const handle = page.locator('[data-slot="resizable-handle"][id^="markdown-split-handle-"]')
      const grip = (await handle.boundingBox())!
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
      await page.mouse.down()
      await page.mouse.move(grip.x + grip.width / 2 - 160, grip.y + grip.height / 2, { steps: 8 })
      await page.mouse.up()
      const after = (await pane.boundingBox())!.width
      ok(
        after > before + 100,
        `Dragging the divider widened the page from ${before}px to ${after}px`,
      )
      await step('resized')

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
      // "## After the fence" is source line 108: its row sits at the top.
      const editor = await selectors
        .editorSurface(page)
        .first()
        .evaluate((element) => {
          const row = Number.parseFloat(
            getComputedStyle(element).getPropertyValue('--editor-row-height'),
          )
          // The viewport is the tall inner layer; its `.editor-virtualized` parent scrolls.
          const scroller = element.closest('.editor-virtualized')!
          return { row, top: scroller.scrollTop }
        })
      const expected = 107 * editor.row
      ok(
        Math.abs(editor.top - expected) <= 2 * editor.row,
        `Preview scroll put the editor at ${editor.top}px, expected about ${expected}px`,
      )
      await step('preview-drives-editor')

      await preview(page).getByRole('link', { name: 'the other file' }).click()
      await selectors.editorTab(page, path.join(fixture, 'other.md').slice(1)).waitFor()
      await step('link-opens-file')

      await selectors.editorTab(page, path.join(fixture, 'guide.md').slice(1)).click()
      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await page.locator('[data-markdown-preview]').waitFor({ state: 'detached' })
      strictEqual(await page.locator('[data-markdown-preview]').count(), 0)
      await step('source-only')

      // Live preview → plain source → the rendered page alone, then back to live preview.
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await runPaletteCommand(page, 'Cycle markdown view')
      await runPaletteCommand(page, 'Cycle markdown view')
      await preview(page).getByRole('heading', { name: 'Guide', level: 1 }).waitFor()
      ok(!(await selectors.editorSurface(page).first().isVisible()), 'the editor is hidden')
      await step('rendered-only')
      // Editor commands reach nothing while only the page shows; the palette may not offer them.
      await pressShortcut(page, chords.commandPalette)
      await selectors.paletteInput(page).fill('>Delete line')
      const deleteLine = selectors.commandOption(page, 'Delete line').first()
      if (await deleteLine.isVisible({ timeout: 2_000 }).catch(() => false))
        await deleteLine.click()
      else await page.keyboard.press('Escape')
      await runPaletteCommand(page, 'Cycle markdown view')
      await page.locator('[data-markdown-preview]').waitFor({ state: 'detached' })
      ok(await selectors.editorSurface(page).first().isVisible(), 'the editor is back')
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === 'Editor input',
        undefined,
        { timeout: 5_000 },
      )
      await page.getByText('const line1 = 1').first().waitFor()
      // Live preview shows `# ` on the caret's line; a deleted line would leave the blank one on top.
      const firstRow = await page
        .locator('.editor-virtualized-row')
        .evaluateAll(
          (rows) =>
            rows
              .filter((row) => row.getBoundingClientRect().height > 0)
              .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
              ?.textContent,
        )
      ok(
        firstRow?.includes('Guide'),
        `the hidden editor kept its first line: ${JSON.stringify(firstRow)}`,
      )
      await step('live-preview-again')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
