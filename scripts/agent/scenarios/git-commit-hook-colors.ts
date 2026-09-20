import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import { fixtureGit, openFixtureWorkspace } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const ESCAPE = String.fromCharCode(27)

// Rejects, so the run never lands a commit and can be repeated on one fixture.
const HOOK = [
  '#!/bin/sh',
  'printf "\\033[38;2;120;120;120m╭──────╮\\033[m\\r\\n"',
  'printf "\\033[38;2;120;120;120m│\\033[m hook: \\033[1mpre-commit\\033[m\\r\\n"',
  'printf "\\033[31mred\\033[m \\033[32mgreen\\033[m \\033[93mbright yellow\\033[m \\033[38;5;39mindexed\\033[m\\n"',
  'exit 1',
  '',
].join('\n')

export const gitCommitHookColors: Scenario = {
  name: 'git-commit-hook-colors',
  description: 'Commit against a rejecting hook that prints SGR colors; the panel paints them.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-commit-colors-')
    try {
      await fixtureGit(fixture, ['init', '--quiet'])
      await writeFile(path.join(fixture, 'a.txt'), 'one\n')
      await fixtureGit(fixture, ['add', 'a.txt'])
      const hook = path.join(fixture, '.git', 'hooks', 'pre-commit')
      await writeFile(hook, HOOK)
      await chmod(hook, 0o755)

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.commitMessage(page).fill('colored hook')
      await selectors.commitButton(page).click()

      const output = selectors.commitOutput(page)
      await output.getByText('pre-commit', { exact: true }).waitFor({ timeout: 15_000 })
      await step('hook-output')

      const text = (await output.textContent()) ?? ''
      if (text.includes('[38;2') || text.includes(ESCAPE))
        throw createScriptError('Commit output shows raw escape sequences')
      const red = await output
        .getByText('red', { exact: true })
        .evaluate((node) => node.style.color)
      if (!red) throw createScriptError('An SGR color did not reach the rendered span')
    } finally {
      await rm(fixture, { force: true, recursive: true })
    }
  },
}
