import { ok, strictEqual } from 'node:assert/strict'
import { readShell, dispatch } from './chat-verification'
import type { Scenario } from './index'
import { selectors } from '../selectors'

export const archiveLifecycle: Scenario = {
  name: 'archive-lifecycle',
  description:
    'Archive an isolated session, open it from archive, reload and explicitly restore it. Deletes only its own session.',
  async run(page, { step }) {
    const connected = page.waitForEvent('websocket', {
      predicate: (socket) => socket.url().endsWith('/orchestration/rpc'),
    })
    await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
    const base = (await connected)
      .url()
      .replace(/^ws/, 'http')
      .replace(/\/rpc$/, '')
    const snapshot = await readShell(page, base)
    const worktree = snapshot.worktrees.find((item) => item.path.endsWith('/projects/platform'))
    ok(worktree, 'Platform worktree must be registered')
    const project = snapshot.projects.find((item) => item.id === worktree.projectId)
    ok(project?.defaultModelSelection, 'Project must have a default model')
    const sessionId = crypto.randomUUID()
    const title = `Archive verification ${sessionId.slice(0, 8)}`
    await dispatch(page, base, {
      type: 'session.create',
      sessionId,
      title,
      worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      modelSelection: project.defaultModelSelection,
    })
    try {
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).waitFor()
      await step('active-session')
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.archiveSession(page).click()
      await selectors.sessionByTitle(page, title).waitFor({ state: 'hidden' })
      const archivedAt = (await readShell(page, base)).sessions.find(
        (item) => item.id === sessionId,
      )?.archivedAt
      ok(archivedAt, 'Archive persisted')
      await step('archived-through-menu')

      await selectors.archivedSessions(page).click()
      await selectors.sessionByTitle(page, title).waitFor()
      await selectors.sessionByTitle(page, title).click()
      await step('archived-session-opened')
      await page.reload()
      await selectors.sessionSearch(page).fill(title)
      const archive = selectors.archivedSessions(page)
      if ((await archive.getAttribute('aria-pressed')) !== 'true') await archive.click()
      await selectors.sessionByTitle(page, title).waitFor()
      await step('archive-survives-reload')
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.restoreSession(page).click()
      await selectors.sessionByTitle(page, title).waitFor({ state: 'hidden' })
      await archive.click()
      await selectors.sessionByTitle(page, title).waitFor()
      const restored = (await readShell(page, base)).sessions.find((item) => item.id === sessionId)
      strictEqual(restored?.archivedAt, null)
      await step('explicit-restore')
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId })
    }
  },
}
