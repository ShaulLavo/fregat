import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import type { Page } from 'playwright'
import { fixtureGit, openFixtureWorkspace } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const LABELS = ['Switch to split diff', 'Switch to stacked diff'] as const

export const editorTitleDiffToggle: Scenario = {
  name: 'editor-title-diff-toggle',
  description:
    'Open a diff tab, switch its layout from the editor title, and switch back so the setting is left alone.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-title-diff-')
    try {
      await fixtureGit(fixture, ['init', '--quiet'])
      await fixtureGit(fixture, ['config', 'user.email', 'fregat@example.com'])
      await fixtureGit(fixture, ['config', 'user.name', 'Fregat'])
      await writeFile(path.join(fixture, 'a.txt'), 'one\ntwo\nthree\n')
      await fixtureGit(fixture, ['add', 'a.txt'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await writeFile(path.join(fixture, 'a.txt'), 'one\nTWO\nthree\n')

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()

      const first = await visibleToggle(page)
      await step('diff-open')
      await selectors.editorTitleAction(page, first).click()
      const second = LABELS.find((label) => label !== first) ?? first
      await selectors.editorTitleAction(page, second).waitFor({ timeout: 10_000 })
      await step('toggled')

      // Back again: the toggle writes the real setting.
      await selectors.editorTitleAction(page, second).click()
      await selectors.editorTitleAction(page, first).waitFor({ timeout: 10_000 })
    } finally {
      await rm(fixture, { force: true, recursive: true })
    }
  },
}

async function visibleToggle(page: Page) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const label of LABELS) {
      if (await selectors.editorTitleAction(page, label).isVisible()) return label
    }
    await Bun.sleep(150)
  }
  throw createScriptError('A diff tab showed no layout toggle in its title')
}
