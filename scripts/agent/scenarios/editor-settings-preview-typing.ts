import { ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CODE_THEME_PREVIEW_SAMPLE } from '../../../apps/web/src/lib/code-theme/utils/preview'
import { committedFixture, openFixtureWorkspace } from '../fixture-workspace'
import {
  chords,
  openFileFromTree,
  pressShortcut,
  runPaletteCommand,
  selectors,
  waitForApp,
} from '../selectors'
import type { Scenario } from './index'

const TYPED = '// Type while Settings previews request syntax highlighting.\n'.repeat(5)

export const editorSettingsPreviewTyping: Scenario = {
  name: 'editor-settings-preview-typing',
  description: `Type ${TYPED.length} comment characters in a small TypeScript fixture while a split Settings pane starts its cold syntax preview. Check the exact inserted text and record snippet and document worker requests during the same interval.`,
  capture: { width: 1440, height: 1000 },
  async run(page, { evidence, step }) {
    const fixture = await committedFixture('settings-preview-typing')
    try {
      await writeFile(path.join(fixture.path, 'preview.ts'), CODE_THEME_PREVIEW_SAMPLE)
      await openFixtureWorkspace(page, fixture.path)
      const url = new URL(page.url())
      url.searchParams.set('editorPerfTrace', '1')
      await page.goto(url.href)
      await waitForApp(page)
      await openFileFromTree(page, 'preview.ts')
      await runPaletteCommand(page, 'Split Editor Right')
      await selectors.editorGroupInput(page, 1).waitFor()
      const rows = selectors.editorGroupRows(page, 0)
      const initial = (await rows.allTextContents()).join('\n')
      strictEqual(
        initial,
        CODE_THEME_PREVIEW_SAMPLE,
        'The fixture shows the production preview sample',
      )
      await pressShortcut(page, chords.settings)
      const row = selectors.settingsRow(page, 'editor.codeTheme.dark')
      await row.waitFor()
      ok((await selectors.settingsCodeThemePreview(page, 'editor.codeTheme.dark').count()) === 0)
      await step('editor-beside-settings')

      await page.evaluate(() => performance.mark('preview-typing:start'))
      await row.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await selectors.editorGroupViewport(page, 0).click()
      await selectors.editorGroupInput(page, 0).focus()
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')
      await page.keyboard.type(TYPED, { delay: 5 })
      await rows.filter({ hasText: 'Type while Settings previews' }).nth(4).waitFor()
      const actual = (await rows.allTextContents()).join('\n')
      const expected = `${initial}\n${TYPED}`
      await evidence.json('typed-text.json', { initial, typed: TYPED, actual, expected })
      strictEqual(actual, expected, 'The editor paints every inserted comment character')
      await step('typed')
      await row.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await selectors.settingsCodeThemePreview(page, 'editor.codeTheme.dark').waitFor()
      await page.evaluate(() => performance.mark('preview-typing:finished'))
      const requests = await page.evaluate(workerRequests)
      await evidence.json('preview-typing-requests.json', requests)
      ok(
        requests.some((mark) => mark.detail?.type === 'highlight'),
        'Settings requests a snippet highlight',
      )
      ok(
        requests.some((mark) => mark.detail?.runtimeSessionId && mark.detail.type === 'edit'),
        'The editor sends document work in the same interval',
      )
      await step('preview-painted-and-text-verified')
    } finally {
      await fixture.release()
    }
  },
}

function workerRequests() {
  const start = performance.getEntriesByName('preview-typing:start')[0]!.startTime
  const finish = performance.getEntriesByName('preview-typing:finished')[0]!.startTime
  return performance
    .getEntriesByName('editor.worker.request')
    .filter((mark) => mark.startTime >= start && mark.startTime <= finish)
    .map((mark) => ({
      at: mark.startTime,
      detail:
        mark instanceof PerformanceMark
          ? (mark.detail as { type?: string; runtimeSessionId?: string })
          : null,
    }))
}
