import { strictEqual } from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  fixtureGit,
  fixturePorcelain,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

export const gitDiscardConfirm: Scenario = {
  name: 'git-discard-confirm',
  description:
    'Discard asks first: Cancel keeps the change, Discard restores it, Delete removes a new file.',
  async run(page, { step }) {
    // Never the dev workspace: confirming a discard there destroys real work.
    const fixture = await mkdtemp('/work/tmp/fregat-git-discard-')
    try {
      await fixtureGit(fixture, ['init', '-b', 'main'])
      await writeFile(path.join(fixture, 'tracked.txt'), 'base\n')
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, [
        '-c',
        'user.name=f',
        '-c',
        'user.email=f@f',
        'commit',
        '-qm',
        'base',
      ])
      await writeFile(path.join(fixture, 'tracked.txt'), 'edited\n')
      await writeFile(path.join(fixture, 'new.txt'), 'new\n')
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      const tracked = selectors.gitChangeRow(page, 'tracked.txt')
      await tracked.waitFor()
      await page.waitForTimeout(1_500)

      await tracked.hover()
      await selectors.gitFileRowAction(page, 'tracked.txt', 'Discard file').click()
      const discardDialog = selectors.gitDiscardDialog(page, 'Discard changes in tracked.txt?')
      await discardDialog.waitFor()
      // Let the enter fade finish so the capture shows the dialog, not its first frame.
      await page.waitForTimeout(400)
      await step('discard-asks')
      await discardDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await discardDialog.waitFor({ state: 'hidden' })
      strictEqual(await readFile(path.join(fixture, 'tracked.txt'), 'utf8'), 'edited\n')

      await tracked.hover()
      await selectors.gitFileRowAction(page, 'tracked.txt', 'Discard file').click()
      await discardDialog.getByRole('button', { name: 'Discard', exact: true }).click()
      await discardDialog.waitFor({ state: 'hidden' })
      await tracked.waitFor({ state: 'detached' })
      strictEqual(await readFile(path.join(fixture, 'tracked.txt'), 'utf8'), 'base\n')
      await step('discarded')

      const untracked = selectors.gitChangeRow(page, 'new.txt')
      await untracked.hover()
      await selectors.gitFileRowAction(page, 'new.txt', 'Discard file').click()
      const deleteDialog = selectors.gitDiscardDialog(page, 'Delete new.txt?')
      await deleteDialog.waitFor()
      await page.waitForTimeout(400)
      await step('delete-asks')
      await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click()
      await untracked.waitFor({ state: 'detached' })
      await step('deleted')
      strictEqual(await fixturePorcelain(fixture), '')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
