import { fail, ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { orchestrationDispatchResultSchema } from '../../../packages/contracts/src/index'
import type { Page } from 'playwright'
import * as v from 'valibot'
import type { Scenario } from './index'
import { selectors, settleAnimations } from '../selectors'
import {
  createGitFixture,
  fixtureApiBase,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { dispatch, readShell } from './chat-verification'

const DRAFT_TEXT = 'carry this draft across worktrees'
const LINKED_BRANCH = 'feature/strip'

async function draftText(page: Page) {
  return (await selectors.chatMessage(page).innerText()).trim()
}

/** The workspace trigger carries the base worktree's path as its title. */
async function waitForBase(page: Page, path: string) {
  await page
    .locator(
      `[aria-label="Workspace"][title="${path.slice(1)}"], [aria-label="Workspace"][title="${path}"]`,
    )
    .waitFor({ timeout: 20_000 })
}

async function registerCheckout(page: Page, workspaceRoot: string) {
  const response = await page.request.post(`${fixtureApiBase(page)}/orchestration/commands`, {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      type: 'project.create',
      commandId: `draft-strip-${crypto.randomUUID()}`,
      defaultModelSelection: null,
      title: 'Draft strip fixture',
      workspaceRoot,
    },
  })
  ok(response.ok(), `Register ${workspaceRoot}`)
  const result = v.parse(orchestrationDispatchResultSchema, await response.json()).result
  ok(result, 'Registration returns its identity')
  return result.projectId
}

async function prepareManagedCheckout(page: Page, projectId: string, root: string) {
  const base = `${fixtureApiBase(page)}/orchestration`
  const shell = await readShell(page, base)
  const worktree = shell.worktrees.find(
    (item) => item.projectId === projectId && item.canonicalPath === root,
  )
  ok(worktree, 'Fixture has a primary checkout')
  const sessionId = crypto.randomUUID()
  const worktreeId = crypto.randomUUID()
  await dispatch(page, base, {
    type: 'session.create',
    sessionId,
    title: 'Release confirmation fixture',
    worktreeTarget: { kind: 'new', worktreeId, baseWorktreeId: worktree.id },
    modelSelection: { providerInstanceId: 'codex', model: 'mock-model' },
  })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const current = (await readShell(page, base)).worktrees.find((item) => item.id === worktreeId)
    if (current?.lifecycle.state === 'ready') {
      await writeFile(
        `${current.canonicalPath}/keep.txt`,
        'Keep this fixture checkout for confirmation.\n',
      )
      await dispatch(page, base, { type: 'session.delete', sessionId })
      return { path: current.canonicalPath, id: worktreeId }
    }
    await Bun.sleep(50)
  }
  fail('Managed fixture checkout did not become ready')
}

/**
 * The strip under a new session's composer, on a fixture repository with one
 * linked worktree: workspace, base branch, and moving the draft into the linked
 * worktree and back with its text. Nothing is sent, so no session is created.
 */
export const chatDraftContextStrip: Scenario = {
  name: 'chat-draft-context-strip',
  description:
    'On a fixture repo with a linked worktree: read the strip under a new session composer, pick New worktree and its base branch, move the draft into the linked worktree and back, and open the machine menu when there is one.',
  async run(page, { step }) {
    const fixture = await createGitFixture('draft-strip')
    const linked = `${fixture}-linked`
    let projectId: string | null = null
    let managed: { path: string; id: string } | null = null
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await fixtureGit(fixture, ['branch', 'release'])
      await fixtureGit(fixture, ['worktree', 'add', '--quiet', '-b', LINKED_BRANCH, linked])
      // Registration order decides which checkout is current: the fixture first, then its worktree.
      projectId = await registerCheckout(page, fixture)
      strictEqual(await registerCheckout(page, linked), projectId)
      await openFixtureWorkspace(page, fixture)
      await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
      const workspace = selectors.draftWorkspace(page)
      // Landing opens a draft of its own; typing before New session lands would fill that one.
      await workspace.waitFor({ timeout: 20_000 })
      const landed = page.url()
      await selectors.chatNewSession(page).click()
      await page.waitForURL((url) => url.href !== landed, { timeout: 20_000 })
      await workspace.waitFor({ timeout: 20_000 })
      await selectors.chatMessage(page).fill(DRAFT_TEXT)
      strictEqual((await workspace.innerText()).trim(), 'Current checkout')
      await step('strip-current-checkout')

      await workspace.click()
      await page.getByRole('menuitemradio', { name: new RegExp(`^${LINKED_BRANCH}`) }).waitFor()
      await settleAnimations(selectors.popupMenu(page))
      await step('workspace-menu')
      await selectors.menuRadio(page, 'New worktree').click()
      await selectors.popupMenu(page).waitFor({ state: 'hidden' })
      strictEqual((await workspace.innerText()).trim(), 'New worktree')
      const branch = selectors.draftBaseBranch(page)
      ok((await branch.innerText()).startsWith('From '), 'New worktree names its base branch')
      await branch.click()
      await selectors.menuRadio(page, 'release').click()
      strictEqual((await branch.innerText()).trim(), 'From release')
      await step('base-branch-release')

      await workspace.click()
      await page.getByRole('menuitemradio', { name: new RegExp(`^${LINKED_BRANCH}`) }).click()
      await waitForBase(page, linked)
      strictEqual((await workspace.innerText()).trim(), 'Worktree')
      strictEqual(await draftText(page), DRAFT_TEXT)
      await step('moved-to-linked-worktree')

      await workspace.click()
      await selectors.menuRadio(page, 'Current checkout').click()
      await waitForBase(page, fixture)
      strictEqual(await draftText(page), DRAFT_TEXT)
      await step('moved-back')

      const machine = selectors.draftMachine(page)
      if ((await machine.count()) > 0) {
        await machine.click()
        await settleAnimations(selectors.popupMenu(page))
        await step('machine-menu')
        await page.keyboard.press('Escape')
      }
      await selectors.chatMessage(page).fill('')
      managed = await prepareManagedCheckout(page, projectId, fixture)
      await selectors.manageWorktrees(page).click()
      await selectors.worktreeManager(page).waitFor()
      await selectors.releaseWorktree(page).first().click()
      const release = selectors.releaseWorktreeDialog(page)
      await release.waitFor()
      ok(
        (await release.innerText()).includes('cleanup ownership'),
        'Release explains its ownership change',
      )
      await step('shared-worktree-release-confirmation')
      await selectors.cancelWorktreeRelease(page).click()
      await release.waitFor({ state: 'hidden' })
      await selectors.worktreeManager(page).waitFor()
      await step('worktree-release-cancelled')
      await page.keyboard.press('Escape')
    } finally {
      if (managed)
        await dispatch(page, `${fixtureApiBase(page)}/orchestration`, {
          type: 'worktree.release',
          worktreeId: managed.id,
        })
      if (projectId)
        await dispatch(page, `${fixtureApiBase(page)}/orchestration`, {
          type: 'project.delete',
          projectId,
        })
      if (managed) await releaseFixture(managed.path)
      await releaseFixture(linked)
      await releaseFixture(fixture)
    }
  },
}
