import { strictEqual } from 'node:assert'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { focusEditor, openFileByName } from '../selectors'
import { assertMarkdownCoverage, markdownCoverageSource } from './prefetch-first-paint'
import type { Scenario } from './index'

export const markdownSourceEditing: Scenario = {
  name: 'markdown-source-editing',
  description:
    'Copy, type, save, undo and redo a complete 1 MB Markdown source with visible preview and EOF references.',
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-markdown-source-'))
    const file = path.join(fixture, 'editing.md')
    const needle = 'MARKFILEediting.md'
    const source =
      markdownCoverageSource(needle) +
      'A paragraph with **strong** and a [reference][coverage-ref].\n\n'.repeat(17000) +
      '\n[coverage-ref]: /definition-at-eof\n'
    try {
      await writeFile(file, source)
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'editing.md')
      await assertMarkdownCoverage(page, needle)
      await step('complete-preview')
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await focusEditor(page)
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Control+c')
      strictEqual(await page.evaluate('navigator.clipboard.readText()'), source)
      await page.keyboard.press('Control+End')
      const addition = '\n末尾🪐 **typed**\n'
      await page.keyboard.insertText(addition)
      await page.keyboard.press('Control+s')
      await waitForSaved(file, source + addition)
      await step('typed-and-saved')
      await page.keyboard.press('Control+z')
      await page.keyboard.press('Control+s')
      await waitForSaved(file, source)
      await page.keyboard.press('Control+Shift+z')
      await page.keyboard.press('Control+s')
      await waitForSaved(file, source + addition)
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Control+v')
      await page.keyboard.press('Control+s')
      await waitForSaved(file, source)
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await assertMarkdownCoverage(page, needle)
      await step('source-restored')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function waitForSaved(file: string, expected: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if ((await readFile(file, 'utf8')) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  strictEqual(await readFile(file, 'utf8'), expected)
}
