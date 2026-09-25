import { ok } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { focusEditor, hoverWord, openFileFromTree, selectors } from '../selectors'

export const editorDiagnosticHoverFix: Scenario = {
  name: 'editor-diagnostic-hover-fix',
  description:
    'A diagnostic hover opens a draft with its exact problem and unsaved source excerpt.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-diagnostic-hover-')
    const restore = await preserveAppearance(page, ['files.autoSave'])
    try {
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      )
      await writeFile(path.join(fixture, 'issue.ts'), 'export const hoverProblem: string = 1\n')
      await writeUserSetting(page, 'files.autoSave', 'off')
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'issue.ts')
      await page.waitForTimeout(7000)
      await hoverWord(page, 'hoverProblem')
      await selectors
        .editorHover(page)
        .getByRole('button', { name: 'Fix with AI', exact: true })
        .waitFor({ timeout: 15000 })
      await page.keyboard.press('Escape')
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.insertText('// unsaved hover context\n')
      await page.waitForTimeout(1000)
      ok(
        (await selectors.editorRows(page).allInnerTexts())
          .join('\n')
          .includes('// unsaved hover context'),
        'The editor contains the unsaved change before requesting the action',
      )
      await hoverWord(page, 'hoverProblem')
      const hover = selectors.editorHover(page)
      const action = hover.getByRole('button', { name: 'Fix with AI', exact: true })
      await action.waitFor({ timeout: 15000 })
      const message = await hover.innerText()
      ok(message.includes('not assignable'), 'The hover contains the type error')
      await step('diagnostic-action')
      await action.focus()
      await page.keyboard.press('Enter')
      const composer = selectors.chatMessage(page)
      await composer.waitFor({ timeout: 15000 })
      await page.waitForFunction(
        (element) => (element?.textContent ?? '').includes('Investigate and fix the cause'),
        await composer.elementHandle(),
        { timeout: 10000 },
      )
      const prompt = (await composer.textContent()) ?? ''
      ok(
        prompt.includes('issue.ts') && prompt.includes('not assignable'),
        'The draft contains the selected diagnostic',
      )
      ok(
        prompt.includes('// unsaved hover context') && prompt.includes('unsaved editor changes'),
        'The draft reads the live buffer',
      )
      await step('unsaved-diagnostic-draft')
    } finally {
      await restore()
      await page.goto(originalUrl)
      await page.waitForTimeout(1000)
      await releaseFixture(fixture)
    }
  },
}
