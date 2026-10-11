import { strictEqual, ok } from 'node:assert/strict'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { committedFixture, openFixtureWorkspace } from '../fixture-workspace'
import { openFileFromTree, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const editorMissingFile: Scenario = {
  name: 'editor-missing-file',
  description:
    'Keep an unopened restored tab after plain deletion, create its missing file, and save retained text after deletion.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const fixture = await committedFixture('editor-missing-file')
    const unopened = path.join(fixture.path, 'unopened.txt')
    const retained = path.join(fixture.path, 'retained.txt')
    const released = Promise.withResolvers<void>()
    try {
      await writeFile(unopened, 'unopened text\n')
      await writeFile(retained, 'retained text\n')
      await openFixtureWorkspace(page, fixture.path)
      await openFileFromTree(page, 'unopened.txt')
      await openFileFromTree(page, 'a.txt')
      await page.route('**/fs/read?**', async (route) => {
        const url = new URL(route.request().url())
        if (url.searchParams.get('path') === unopened.slice(1)) {
          await released.promise
        }
        await route.continue()
      })
      const request = page.waitForRequest(
        (request) => new URL(request.url()).searchParams.get('path') === unopened.slice(1),
        { timeout: 30_000 },
      )
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      await selectors.editorTab(page, unopened.slice(1)).hover()
      await request
      await unlink(unopened)
      released.resolve()
      const tab = selectors.editorTab(page, unopened.slice(1))
      await tab.getByText('unopened.txt (missing)', { exact: true }).waitFor()
      await tab.click()
      await selectors.missingFileMessage(page).waitFor()
      ok(await selectors.createMissingFile(page).isEnabled())
      ok(await selectors.fileReadRetry(page).isEnabled())
      await step('unopened-restored-tab-missing')
      await selectors.createMissingFile(page).click()
      await selectors.missingFileMessage(page).waitFor({ state: 'hidden' })
      strictEqual(await readFile(unopened, 'utf8'), '')
      await step('missing-file-created')

      await openFileFromTree(page, 'retained.txt')
      await selectors.editorRows(page).filter({ hasText: 'retained text' }).waitFor()
      await unlink(retained)
      await selectors.fileReadErrorHeader(page).waitFor()
      await selectors.saveMissingFile(page).waitFor()
      await step('opened-tab-missing-retains-text')
      await selectors.saveMissingFile(page).click()
      await selectors.fileReadErrorHeader(page).waitFor({ state: 'hidden' })
      strictEqual(await readFile(retained, 'utf8'), 'retained text\n')
      await step('retained-text-saved')
    } finally {
      released.resolve()
      await fixture.release()
    }
  },
}
