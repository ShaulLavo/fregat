import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture, waitForFileContent } from '../fixture-workspace'
import { focusEditor, openFileByName, runPaletteCommand, selectors } from '../selectors'

const targetText = '// Definition fixture\r\n\r\nexport const crlfTarget = 42\r\n'

export const editorDefinitionCrlf: Scenario = {
  name: 'editor-definition-crlf',
  description:
    'Go to a definition in a CRLF file and prove its caret offset by saving an insertion.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-definition-crlf-')
    const target = path.join(fixture, 'target.ts')
    try {
      await writeFile(target, targetText)
      await writeFile(
        path.join(fixture, 'caller.ts'),
        "import { crlfTarget } from './target'\r\nconsole.log(crlfTarget)\r\n",
      )
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        '{"compilerOptions":{"strict":true},"include":["*.ts"]}',
      )
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'caller.ts')
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('End')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(3000)
      await step('definition-request')
      await runPaletteCommand(page, 'Go to definition')
      await selectors.editorTab(page, target.slice(1)).waitFor({ timeout: 30_000 })
      await step('definition-selected')
      await page.keyboard.insertText('prefix_')
      await page.keyboard.press('Control+s')
      await waitForFileContent(
        target,
        targetText.replaceAll('\r\n', '\n').replace('crlfTarget', 'prefix_crlfTarget'),
      )
      await step('selection-proven-on-disk')
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}
