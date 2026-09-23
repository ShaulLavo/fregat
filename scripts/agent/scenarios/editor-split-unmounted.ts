import { strictEqual } from 'node:assert'
import { openFileByName, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

export const editorSplitUnmounted: Scenario = {
  name: 'editor-split-unmounted',
  description:
    'Split the active editor from chat mode while no editor group is mounted, then find the split in the workbench.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    strictEqual(await selectors.editorGroups(page).count(), 1)

    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.chatToolTab(page, 'Files').click()
    await page.waitForTimeout(400)
    strictEqual(await selectors.editorGroups(page).count(), 0, 'no editor group is mounted')
    await step('chat-without-editor')

    await runPaletteCommand(page, 'Split Editor Right')
    await step('split-requested')
    // A declined command leaves the palette open.
    await selectors.paletteInput(page).waitFor({ state: 'hidden', timeout: 3_000 })

    await selectors.workspaceMode(page, 'Workbench').click()
    await selectors.editorGroups(page).first().waitFor()
    await page.waitForTimeout(400)
    await step('workbench-after-split')
    strictEqual(
      await selectors.editorGroups(page).count(),
      2,
      'a split requested while no group was mounted still lands',
    )
  },
}
