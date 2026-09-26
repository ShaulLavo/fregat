import { strictEqual, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { countBlankFrames, recordFrames } from '../blank-frames'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { serverApi } from '../server-api'

async function historyFixture(name: string) {
  const root = await createGitFixture(`history-${name}`)
  for (let index = 0; index < 4; index += 1) {
    await writeFile(`${root}/a.txt`, `${name} ${index}\n`)
    await fixtureGit(root, ['add', 'a.txt'])
    await fixtureGit(root, ['commit', '--quiet', '-m', `${name} commit ${index}`])
  }
  return root
}

async function waitForCommit(page: Page, id: string) {
  await selectors.historyInformationFor(page, id).waitFor()
  await selectors.historyFiles(page).first().waitFor()
}

async function switchCommits(page: Page) {
  for (let index = 1; index < 4; index += 1) {
    const row = selectors.historyRows(page).nth(index)
    const id = await row.getAttribute('data-history-commit')
    ok(id)
    await row.click()
    await waitForCommit(page, id)
  }
}

async function measureCommitSwitches(page: Page) {
  const subjects = new Map(
    await selectors
      .historyRows(page)
      .evaluateAll((rows) =>
        rows.map(
          (row) =>
            [row.getAttribute('data-history-commit'), row.getAttribute('aria-label')] as const,
        ),
      ),
  )
  let blank = 0
  const frames = await recordFrames<{ hash: string; subject: string }>(
    page,
    selectors.historyDetailsFrameSampler,
    async () => {
      blank = await countBlankFrames(page, selectors.historyFileSelector, () => switchCommits(page))
    },
  )
  for (const frame of frames)
    strictEqual(
      frame.subject,
      subjects.get(frame.hash),
      'The commit header and body name the same commit in every frame',
    )
  return blank
}

export const gitHistoryNoFlicker: Scenario = {
  name: 'git-history-no-flicker',
  description:
    'Switch loaded commits, refs, and repository roots under delayed reads; count blank frames.',
  async run(page, { step }) {
    const alpha = await historyFixture('alpha')
    const beta = await historyFixture('beta')
    try {
      await openFixtureWorkspace(page, beta)
      await openGitPanel(page)
      await selectors.graphButton(page).click()
      await selectors.historyRows(page).first().waitFor()
      await openFixtureWorkspace(page, alpha)
      await openGitPanel(page)
      await selectors.graphButton(page).click()
      await selectors.historyRows(page).nth(3).waitFor()
      await selectors.historyRows(page).first().click()
      await selectors.historyFiles(page).first().waitFor()
      await step('loaded-history')
      await page.route('**/git/history**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 450))
        await route.continue()
      })
      const commitBlank = await measureCommitSwitches(page)
      await step(`commit-blank-frames-${commitBlank}`)
      const refBlank = await countBlankFrames(page, selectors.historyRowSelector, async () => {
        await selectors.historyCurrent(page).click()
        await selectors.historyReference(page).and(page.locator('[title="HEAD"]')).waitFor()
        await page.waitForTimeout(700)
      })
      await step(`ref-blank-frames-${refBlank}`)
      const { base, headers } = serverApi(page)
      const recorded = await page.request.post(`${base}/fs/recents`, {
        data: { path: beta.slice(1) },
        headers,
      })
      ok(recorded.ok())
      await selectors.projectMenuTrigger(page).click()
      const rootBlank = await countBlankFrames(page, selectors.historyRowSelector, async () => {
        await selectors
          .projectMenuRows(page)
          .filter({ hasText: beta.split('/').at(-1) })
          .first()
          .click()
        await selectors
          .historyRows(page)
          .filter({ hasText: 'beta commit' })
          .first()
          .waitFor({ timeout: 20_000 })
      })
      await selectors.projectMenuTrigger(page).click()
      await selectors.historyRows(page).last().click()
      await selectors.historyFiles(page).first().waitFor()
      await step(`root-blank-frames-${rootBlank}`)
      strictEqual(commitBlank, 0, 'Commit selection blanked the loaded details')
      strictEqual(refBlank, 0, 'Ref selection blanked the loaded history')
      strictEqual(rootBlank, 0, 'Root selection blanked the loaded history')
    } finally {
      await releaseFixture(alpha)
      await releaseFixture(beta)
    }
  },
}
