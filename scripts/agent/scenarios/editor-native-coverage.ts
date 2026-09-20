import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { editorSyntaxBenchmark } from './editor-syntax-benchmark'
import { focusEditor } from '../selectors'

export function editorNativeCoverage(palette: 'light' | 'dark'): Scenario {
  const benchmark = editorSyntaxBenchmark('native', true, palette)
  return {
    ...benchmark,
    name: `editor-native-coverage-${palette}`,
    description:
      'Inspect native MDX, SQL, Astro or Markdown injections in a built-in palette, edit syntax, undo and redo without starting Shiki.',
    async run(page, context) {
      await benchmark.run(page, context)
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('End')
      await page.keyboard.type(' /* native coverage */')
      await page.waitForTimeout(500)
      await context.step('token-edit')
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(300)
      await context.step('undo')
      await page.keyboard.press('Control+Shift+z')
      await page.waitForTimeout(300)
      await context.step('redo')
      const requests = await page.evaluate(() => window.syntaxBenchmark.requests)
      ok(requests.some((request) => request.family === 'tree-sitter'))
      ok(!requests.some((request) => request.family === 'shiki'))
      ok(!requests.some((request) => request.error))
    },
  }
}
