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
import { registerFixtureProject } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

const DRAFT_TEXT = 'carry this draft across worktrees'
const LINKED_BRANCH = 'feature/strip'

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

async function createRecordedBranch(page: Page, root: string) {
  const orchestration = `${fixtureApiBase(page)}/orchestration`
  const base = await registerFixtureProject(page, orchestration, root)
  const worktreeId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  await dispatch(page, orchestration, {
    type: 'session.create',
    sessionId,
    title: 'Branch parent fixture',
    worktreeTarget: { kind: 'new', worktreeId, baseWorktreeId: base.id, baseBranch: 'release' },
    modelSelection: { providerInstanceId: 'codex', model: 'gpt-5.5' },
  })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worktree = (await readShell(page, orchestration)).worktrees.find(
      (item) => item.id === worktreeId,
    )
    if (worktree?.lifecycle.state === 'ready' && worktree.branch) return { worktree, sessionId }
    await Bun.sleep(100)
  }
  throw createScriptError('The branch fixture did not become ready')
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
    let recordedWorktreeId: string | null = null
    let recordedSessionId: string | null = null
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
      await selectors.fillChatMessage(page, DRAFT_TEXT)
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
      strictEqual(
        await selectors.branchLanes(page).count(),
        0,
        'External branches have no inferred parent',
      )
      await step('flat-branch-picker')
      await selectors.menuRadio(page, 'release').click()
      strictEqual((await branch.innerText()).trim(), 'From release')
      await step('base-branch-release')

      const created = await createRecordedBranch(page, fixture)
      recordedWorktreeId = created.worktree.id
      recordedSessionId = created.sessionId
      const childBranch = created.worktree.branch!
      await selectors.draftBaseBranch(page).click()
      const child = selectors.menuRadio(page, childBranch)
      await child.waitFor({ timeout: 20_000 })
      strictEqual(await child.getAttribute('title'), `${childBranch} · Created from release`)
      const lanes = selectors.branchLanes(page)
      ok((await lanes.count()) > 0, 'Recorded ancestry draws lanes after reload')
      const widths = await lanes.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().width),
      )
      strictEqual(new Set(widths).size, 1, 'Every row reserves the same gutter')
      strictEqual(
        await selectors.menuRadio(page, LINKED_BRANCH).getAttribute('title'),
        LINKED_BRANCH,
      )
      await step('recorded-branch-parent')
      await child.click()
      strictEqual((await selectors.draftBaseBranch(page).innerText()).trim(), `From ${childBranch}`)
      await page.reload()
      await selectors.draftBaseBranch(page).click()
      await selectors.menuRadio(page, childBranch).waitFor()
      strictEqual(
        await selectors.menuRadio(page, childBranch).getAttribute('title'),
        `${childBranch} · Created from release`,
      )
      await step('recorded-parent-after-reload')
      await page.keyboard.press('Escape')
      await selectors.popupMenu(page).waitFor({ state: 'hidden' })

      await workspace.click()
      await page.getByRole('menuitemradio', { name: new RegExp(`^${LINKED_BRANCH}`) }).click()
      await waitForBase(page, linked)
      strictEqual((await workspace.innerText()).trim(), 'Worktree')
      strictEqual(await selectors.chatPromptText(page), DRAFT_TEXT)
      await step('moved-to-linked-worktree')

      await workspace.click()
      await selectors.menuRadio(page, 'Current checkout').click()
      await waitForBase(page, fixture)
      strictEqual(await selectors.chatPromptText(page), DRAFT_TEXT)
      await step('moved-back')

      const machine = selectors.draftMachine(page)
      if ((await machine.count()) > 0) {
        await machine.click()
        await settleAnimations(selectors.popupMenu(page))
        await step('machine-menu')
        await page.keyboard.press('Escape')
      }
      await selectors.fillChatMessage(page, '')
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
      if (recordedSessionId)
        await dispatch(page, `${fixtureApiBase(page)}/orchestration`, {
          type: 'session.delete',
          sessionId: recordedSessionId,
        })
      if (recordedWorktreeId)
        await dispatch(page, `${fixtureApiBase(page)}/orchestration`, {
          type: 'worktree.release',
          worktreeId: recordedWorktreeId,
        })
      if (managed)
        await dispatch(page, `${fixtureApiBase(page)}/orchestration`, {
          type: 'worktree.release',
          worktreeId: managed.id,
        })
      if (projectId)
        await dispatch(page, `${fixtureApiBase(page)}/orchestration`, {
          type: 'project.delete',
          projectId,
          force: true,
        })
      if (managed) await releaseFixture(managed.path)
      await releaseFixture(linked)
      await releaseFixture(fixture)
    }
  },
}
