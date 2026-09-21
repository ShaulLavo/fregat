import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { collectOrchestrationBases, dispatch, readShell } from './chat-verification'

async function searchConversation(
  page: Page,
  step: (name: string) => Promise<void>,
  crossOwner: boolean,
) {
  const bases = collectOrchestrationBases(page)
  const connected = page.waitForEvent('websocket', {
    predicate: (socket) => socket.url().endsWith('/orchestration/rpc'),
  })
  await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
  const primary = (await connected)
    .url()
    .replace(/^ws/, 'http')
    .replace(/\/rpc$/, '')
  await selectors.sessionSearch(page).waitFor()
  if (crossOwner) await page.waitForTimeout(2_000)
  const remote = [...bases].find((base) => base !== primary)
  ok(
    !crossOwner || remote,
    'Cross-owner scenario requires two connected environments already represented in the rail',
  )
  const base = crossOwner ? remote! : primary
  const snapshot = await readShell(page, base)
  const worktree =
    snapshot.worktrees.find((item) => item.path.endsWith('/projects/platform')) ??
    snapshot.worktrees[0]
  ok(worktree, 'Search owner needs a registered worktree')
  const project = snapshot.projects.find((item) => item.id === worktree.projectId)
  ok(project?.defaultModelSelection, 'Search owner needs a default model')
  const sessionId = crypto.randomUUID()
  const title = `Search verification ${sessionId.slice(0, 8)}`
  const needle = `hiddenneedle${sessionId.replaceAll('-', '')}`
  await dispatch(page, base, {
    type: 'session.create',
    sessionId,
    title,
    modelSelection: project.defaultModelSelection,
    worktreeTarget: { kind: 'current', worktreeId: worktree.id },
  })
  let primaryFixture = false
  const primaryTitle = `Primary ${title}`
  try {
    if (crossOwner) {
      const primarySnapshot = await readShell(page, primary)
      const primaryWorktree = primarySnapshot.worktrees.find((item) =>
        item.path.endsWith('/projects/platform'),
      )
      ok(primaryWorktree, 'Primary owner needs the Platform worktree')
      const primaryProject = primarySnapshot.projects.find(
        (item) => item.id === primaryWorktree.projectId,
      )
      ok(primaryProject?.defaultModelSelection, 'Primary owner needs a default model')
      await dispatch(page, primary, {
        type: 'session.create',
        sessionId,
        title: primaryTitle,
        modelSelection: primaryProject.defaultModelSelection,
        worktreeTarget: { kind: 'current', worktreeId: primaryWorktree.id },
      })
      primaryFixture = true
    }
    await selectors.sessionSearch(page).fill(title)
    await selectors.sessionByTitle(page, title).click()
    await selectors
      .chatMessage(page)
      .fill(`Reply with exactly ${needle}. Do not use tools, inspect files or change files.`)
    await selectors.chatSend(page).click()
    await selectors
      .chatMessages(page)
      .getByText(needle, { exact: true })
      .waitFor({ timeout: 90_000 })
    if (crossOwner) {
      await selectors.sessionSearch(page).fill(primaryTitle)
      await selectors.sessionByTitle(page, primaryTitle).click()
    }
    await selectors.sessionSearch(page).fill(needle)
    await selectors.sessionByTitle(page, title).waitFor()
    await step(
      crossOwner ? 'remote-message-found-from-shared-rail' : 'message-found-without-title-match',
    )
    await selectors.sessionSearch(page).fill(`absent${sessionId}`)
    ok(
      !(await selectors.sessionByTitle(page, title).isVisible()),
      'A new query must immediately discard the previous query matches',
    )
    await selectors.sessionByTitle(page, title).waitFor({ state: 'hidden' })
    await step('new-query-does-not-reuse-old-matches')
    await selectors.sessionSearch(page).fill(needle)
    await selectors.sessionByTitle(page, title).waitFor()
    await step('cached-query-keeps-correct-owner')
  } finally {
    await dispatch(page, base, { type: 'session.delete', sessionId })
    if (primaryFixture) await dispatch(page, primary, { type: 'session.delete', sessionId })
  }
}

export const sessionSearch: Scenario = {
  name: 'session-search',
  description:
    'Find hidden message text in one disposable real-provider session and reject stale matches after typing a new query.',
  run: (page, { step }) => searchConversation(page, step, false),
}

export const sessionSearchEnvironments: Scenario = {
  name: 'session-search-environments',
  description:
    'Search hidden message text owned by another connected environment. Requires two existing live owners; uses one disposable real-provider session.',
  run: (page, { step }) => searchConversation(page, step, true),
}
