import { notEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { chords, openFileByName, selectors, waitForApp } from '../selectors'

export const editorThemePreview: Scenario = {
  name: 'editor-theme-preview',
  description: 'Preview three syntax themes, revisit them, and cancel without changing settings.',
  async run(page, { file, step }) {
    const url = new URL(page.url())
    url.searchParams.set('editorPerfTrace', '1')
    await page.goto(url.href)
    await waitForApp(page)
    await openFileByName(page, file)
    await page.waitForTimeout(2000)
    const committedColors = await syntaxColors(page)
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('theme ')
    await selectors.codeThemeOptions(page).first().waitFor()
    const ids = await selectors.codeThemeOptions(page).evaluateAll((rows) =>
      rows
        .map((row) => row.getAttribute('data-value')!.replace('color-theme:', ''))
        .filter((id) => !id.startsWith('tree-sitter'))
        .slice(0, 3),
    )
    ok(ids.length === 3, 'The picker exposes three syntax themes')
    await page.waitForTimeout(2000)
    await step('ready')
    let lastColors = ''
    for (const [index, id] of [...ids, ...ids].entries()) {
      await page.evaluate(() => performance.mark('theme-preview:hover'))
      await selectors.codeThemeOption(page, id).hover()
      await page.waitForTimeout(1200)
      const colors = await syntaxColors(page)
      ok(colors, 'The background editor has painted syntax colors')
      if (index > 0) notEqual(colors, lastColors, 'The editor colors follow the highlighted theme')
      lastColors = colors
      await step(`preview-${index}-${id}`)
    }
    await page.evaluate(() => performance.mark('theme-preview:finished'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)
    await step('cancelled')
    strictEqual(
      await syntaxColors(page),
      committedColors,
      'Escape restores the committed syntax colors',
    )
    const marks = await page.evaluate(() =>
      performance
        .getEntriesByType('mark')
        .filter(
          (mark) => mark.name === 'editor.worker.request' || mark.name.startsWith('theme-preview:'),
        )
        .map((mark) => ({
          name: mark.name,
          at: mark.startTime,
          detail: mark instanceof PerformanceMark ? mark.detail : null,
        })),
    )
    const steadyStart = marks.filter((mark) => mark.name === 'theme-preview:hover')[1]!.at
    const finish = marks.find((mark) => mark.name === 'theme-preview:finished')!.at
    const requests = marks.filter(
      (mark) => mark.at >= steadyStart && mark.at < finish && mark.detail?.family === 'shiki',
    )
    strictEqual(requests.length, 5, 'Each theme switch sends one worker request')
    ok(
      requests.every((mark) => mark.detail.type === 'recolor'),
      'Theme switches never reopen documents',
    )
    strictEqual(
      new Set(requests.map((mark) => mark.detail.runtimeSessionId)).size,
      1,
      'The worker session survives all previews',
    )
  },
  inspect: (page) => page.evaluate('window.__editorPerfTrace.report()'),
}

function syntaxColors(page: Page): Promise<string> {
  return selectors
    .editorSurface(page)
    .first()
    .evaluate((element) =>
      Array.from(CSS.highlights.entries())
        .filter(
          ([name, highlight]) => name.startsWith('editor-shared-token-') && highlight.size > 0,
        )
        .map(([name]) => getComputedStyle(element, `::highlight(${name})`).color)
        .sort()
        .join('|'),
    )
}
