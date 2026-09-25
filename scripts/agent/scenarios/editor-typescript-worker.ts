import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'

export const editorTypeScriptWorker: Scenario = {
  name: 'editor-typescript-worker',
  description:
    'Rename across files, import a missing symbol, and format using the TypeScript worker.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-typescript-worker-')
    const restore = await preserveAppearance(page, ['lsp.typescript.backend'])
    const backend = process.env.L7_TYPESCRIPT_BACKEND === 'server' ? 'server' : 'worker'
    try {
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
          },
          include: ['*.ts'],
        }),
      )
      await writeFile(path.join(fixture, 'a.ts'), 'export const renameMe = 1\n')
      await writeFile(
        path.join(fixture, 'b.ts'),
        'import { renameMe } from "./a"\nconsole.log(renameMe)\nexport const instance = new Greeter()\n',
      )
      await writeFile(path.join(fixture, 'c.ts'), 'export class Greeter {}\n')
      await writeUserSetting(page, 'lsp.typescript.backend', backend)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.ts')
      await focusEditor(page)
      await page.waitForTimeout(7000)
      await renameExport(page, 'renamedValue')
      await page.waitForTimeout(1500)
      ok(
        (await readFile(path.join(fixture, 'b.ts'), 'utf8')).includes('renamedValue'),
        'rename applies to the unopened second file',
      )
      await step(`${backend}-cross-file-rename`)
      await openFileFromTree(page, 'b.ts')
      await focusEditor(page)
      await page.waitForTimeout(7000)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('// unsaved note\n')
      await openFileFromTree(page, 'a.ts')
      await focusEditor(page)
      await page.waitForTimeout(2500)
      await renameExport(page, 'finalValue')
      await openFileFromTree(page, 'b.ts')
      await focusEditor(page)
      await page.waitForTimeout(2000)
      const dirtyText = (await selectors.editorRows(page).allInnerTexts()).join('\n')
      ok(
        dirtyText.includes('finalValue') && dirtyText.includes('// unsaved note'),
        'cross-file rename retains another tab’s unsaved edit',
      )
      await step(`${backend}-dirty-tab-rename`)
      if (process.env.L7_TYPESCRIPT_COMPARE === 'rename') return
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Home')
      for (let index = 0; index < 'export const instance = new '.length; index++)
        await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(2500)
      await page.keyboard.press('Alt+Shift+.')
      await page.waitForTimeout(1200)
      const apply = selectors.workspaceEditApplyAll(page)
      if (await apply.isVisible()) await apply.click()
      await page.waitForTimeout(1000)
      await step(`${backend}-quick-fix`)
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('\nexport const   formatted   =   2')
      await page.waitForTimeout(500)
      await page.keyboard.press('Alt+Shift+F')
      await page.waitForTimeout(1500)
      const text = (await selectors.editorRows(page).allInnerTexts()).join('\n')
      ok(
        text.includes('from "./c"') || text.includes("from './c'"),
        'quick fix imports the missing symbol',
      )
      strictEqual(text.includes('const   formatted'), false, 'format rewrites the spacing')
      await step(`${backend}-formatted`)
    } catch (error) {
      await step('failure-before-cleanup')
      throw error
    } finally {
      await page.goto(originalUrl)
      await page.waitForTimeout(1000)
      await restore()
      await releaseFixture(fixture)
    }
  },
}

async function renameExport(page: Page, name: string) {
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < 'export const '.length; index++)
    await page.keyboard.press('ArrowRight')
  await runPaletteCommand(page, 'Rename symbol')
  await selectors.renameInput(page).waitFor({ timeout: 20_000 })
  await selectors.renameInput(page).fill(name)
  await page.keyboard.press('Enter')
  await selectors.workspaceEditApplyAll(page).click({ timeout: 20_000 })
}
