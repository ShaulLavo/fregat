import { rm } from 'node:fs/promises'

import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureHeadSubject,
  installPreCommitHook,
  openFixtureWorkspace,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const SUBJECT = 'feat: survived a slow hook'

// Silent past the old 30s local limit and across two 15s stream heartbeats.
const HOOK = ['#!/bin/sh', 'echo "typechecking"', 'sleep 35', 'echo "done"', 'exit 0', ''].join(
  '\n',
)

export const gitCommitSlowHook: Scenario = {
  name: 'git-commit-slow-hook',
  description:
    'Commit through a pre-commit hook that is silent for 35 seconds, and find the commit.',
  async run(page, { step }) {
    const fixture = await createGitFixture('slow-hook')
    try {
      await installPreCommitHook(fixture, HOOK)

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.commitMessage(page).fill(SUBJECT)
      await selectors.commitButton(page).click()
      await selectors.commitOutput(page).getByText('typechecking').waitFor({ timeout: 15_000 })
      await step('hook-running')

      await waitForHeadSubject(fixture)
      if (await selectors.gitFixWithAgent(page).isVisible())
        throw createScriptError('The commit landed but the panel still reports a failure')
      await step('committed')
    } finally {
      await rm(fixture, { force: true, recursive: true })
    }
  },
}

async function waitForHeadSubject(fixture: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if ((await fixtureHeadSubject(fixture)) === SUBJECT) return
    await Bun.sleep(500)
  }
  throw createScriptError(
    `The slow hook's commit never landed: HEAD is "${await fixtureHeadSubject(fixture)}"`,
  )
}
