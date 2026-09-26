import { strictEqual } from 'node:assert/strict'
import { countBlankFrames } from '../blank-frames'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import type { Scenario } from './index'
import { dispatch, openChat } from './chat-verification'
import {
  registerFixtureProject,
  settingsSnapshot,
  restoreUserSettings,
  writeSettings,
} from './native-provider-verification'

export const branchActionsNoFlicker: Scenario = {
  name: 'branch-actions-no-flicker',
  description:
    'Click sessions on different fixture worktrees while delayed branch reads retain Push.',
  async run(page, { step }) {
    const base = await openChat(page)
    const api = base.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, api)
    const providerInstanceId = 'branch-actions-fixture'
    await writeSettings(page, api, [
      {
        kind: 'provider.setEnabled',
        providerInstanceId,
        enabled: true,
        createIfMissing: { driverKind: 'mock', displayLabel: 'Branch fixture', config: {} },
      },
    ])
    const fixtures: { root: string; sessionId: string; projectId: string; title: string }[] = []
    try {
      for (let index = 1; index <= 3; index += 1) {
        const root = await createGitFixture('branch-actions-no-flicker')
        await fixtureGit(root, ['checkout', '-b', 'main'])
        await fixtureGit(root, ['commit', '--quiet', '-m', `initial-${index}`])
        await fixtureGit(root, ['init', '--bare', '--quiet', 'origin.git'])
        await fixtureGit(root, ['remote', 'add', 'origin', `${root}/origin.git`])
        await fixtureGit(root, ['push', '-u', 'origin', 'main'])
        for (let commit = 0; commit < index; commit += 1)
          await fixtureGit(root, ['commit', '--quiet', '--allow-empty', '-m', 'ahead'])
        const worktree = await registerFixtureProject(page, base, root)
        const sessionId = crypto.randomUUID()
        const title = `Branch retention ${index}`
        await dispatch(page, base, {
          type: 'session.create',
          sessionId,
          title,
          modelSelection: { providerInstanceId, model: 'gpt-5.5' },
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        })
        fixtures.push({ root, sessionId, projectId: worktree.projectId, title })
      }
      await page.route('**/git/branch-remote-state?*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400))
        await route.continue()
      })
      await selectors.sessionSearch(page).fill('Branch retention')
      await selectors.sessionByTitle(page, fixtures[0]!.title).click()
      await step('first-session-selected')
      await selectors.branchPush(page, 1).waitFor()
      await step('first-branch-loaded')
      for (const [index, fixture] of fixtures.entries()) {
        if (index === 0) continue
        const blank = await countBlankFrames(page, selectors.branchActionSelector, async () => {
          await selectors.sessionByTitle(page, fixture.title).click()
          await selectors.branchPush(page, index + 1).waitFor()
        })
        await step(`branch-${index + 1}-blank-frames-${blank}`)
        strictEqual(blank, 0, 'Branch actions vanished during the worktree read')
      }
    } finally {
      for (const fixture of fixtures) {
        await dispatch(page, base, { type: 'session.delete', sessionId: fixture.sessionId })
      }
      for (const projectId of new Set(fixtures.map((fixture) => fixture.projectId)))
        await dispatch(page, base, { type: 'project.delete', projectId, force: true })
      for (const fixture of fixtures) await releaseFixture(fixture.root)
      await restoreUserSettings(page, api, before, ['providers.instances'])
    }
  },
}
