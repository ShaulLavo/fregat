import { ok } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

export async function prepareFixture() {
  const fixture = await createGitFixture('checkpoint-states')
  await mkdir(join(fixture, 'src'), { recursive: true })
  await writeFile(join(fixture, 'src/app.ts'), 'export const app = 1\n')
  await fixtureGit(fixture, ['add', '--all'])
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

async function sendTurn(page: Page, text: string) {
  await selectors.chatMessage(page).fill(text)
  await selectors.chatSend(page).click()
  await selectors.chatMessages(page).getByText('CHECKPOINT_TURN_DONE').nth(0).waitFor()
}

/** One native turn that edits src/app.ts in the fixture worktree. */
export async function changeAppConstant(page: Page, root: string, worktreePath: string) {
  await writeFile(
    join(root, 'checkpoint-control.json'),
    JSON.stringify({
      cwd: worktreePath,
      hold: false,
      turns: [[{ op: 'write', path: 'src/app.ts', text: 'export const app = 2\n' }]],
    }),
  )
  await sendTurn(page, 'Change the app constant.')
}

export async function showTurnScope(page: Page) {
  const git = selectors.chatToolTab(page, 'Git')
  await git.waitFor({ timeout: 20_000 })
  if (!(await selectors.gitPanel(page).isVisible())) await git.click()
  await selectors.gitDiffScope(page, 'Turn').click()
}

export const checkpointStates = isolatedNativeScenario({
  name: 'checkpoint-states',
  description:
    'A native checkpoint fixture: turn 1 edits a file (available in the timeline and the Turn panel), turn 2 edits nothing (the Turn panel says so, the timeline adds nothing).',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: prepareFixture,
  async drive(page, { root, step, worktreePath }) {
    await changeAppConstant(page, root, worktreePath)
    await selectors.changedFilesTree(page).last().waitFor({ timeout: 30_000 })
    await showTurnScope(page)
    await selectors.turnFiles(page).getByRole('treeitem').first().waitFor({ timeout: 15_000 })
    await step('available')

    await selectors.chatMessage(page).fill('Say done without editing anything.')
    await selectors.chatSend(page).click()
    await selectors.chatMessages(page).getByText('CHECKPOINT_TURN_DONE').nth(1).waitFor()
    await selectors.gitDiffScope(page, 'Working tree').click()
    await selectors.gitDiffScope(page, 'Turn').click()
    await page.getByText('No changed files in turn 2', { exact: true }).waitFor({ timeout: 15_000 })
    await step('ready-empty')
    ok(
      (await selectors.changedFilesTree(page).count()) === 1,
      'The empty turn adds no changed-files card to the transcript',
    )
  },
})
