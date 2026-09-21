import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChatShell, readShell } from './chat-verification'

export const sessionNavigation: Scenario = {
  name: 'session-navigation',
  description:
    'Archive the current session into its project draft, preserve a background archive route, and delete into the first surviving session. Uses three disposable sessions on one connected owner.',
  async run(page, { step }) {
    const { base, project, worktree } = await openChatShell(page)
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    const prefix = `Navigation verification ${ids[0]!.slice(0, 8)}`
    const titles = ids.map((_, index) => `${prefix} ${index + 1}`)
    const created: string[] = []
    try {
      for (const [index, sessionId] of ids.entries()) {
        await dispatch(page, base, {
          type: 'session.create',
          sessionId,
          title: titles[index],
          modelSelection: project.defaultModelSelection,
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        })
        created.push(sessionId)
      }
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionByTitle(page, titles[0]!).click({ button: 'right' })
      await step('owner-copy-actions')
      await selectors.copySessionPath(page).click()
      strictEqual(await page.evaluate(() => navigator.clipboard.readText()), worktree.path)
      await selectors.sessionByTitle(page, titles[0]!).click({ button: 'right' })
      await selectors.copySessionId(page).click()
      strictEqual(await page.evaluate(() => navigator.clipboard.readText()), ids[0])
      if (worktree.branch) {
        await selectors.sessionByTitle(page, titles[0]!).click({ button: 'right' })
        await selectors.copySessionBranch(page).click()
        strictEqual(await page.evaluate(() => navigator.clipboard.readText()), worktree.branch)
      }
      await selectors.sessionByTitle(page, titles[1]!).click()
      await selectors.sessionByTitle(page, titles[1]!).click({ button: 'right' })
      await selectors.archiveSession(page).click()
      await page.waitForURL((url) => decodeURIComponent(url.href).includes('t/new'))
      await step('current-archive-opens-owner-draft')
      await selectors.sessionByTitle(page, titles[0]!).click()
      await page.waitForURL((url) => decodeURIComponent(url.href).includes(ids[0]!))
      await selectors.sessionByTitle(page, titles[2]!).click({ button: 'right' })
      await selectors.archiveSession(page).click()
      await selectors.sessionByTitle(page, titles[2]!).waitFor({ state: 'hidden' })
      strictEqual(
        new URL(page.url()).pathname.split('/t/')[1],
        ids[0],
        'Background archive must preserve the selected session',
      )
      await step('background-archive-preserves-current')
      await dispatch(page, base, { type: 'session.unarchive', sessionId: ids[1] })
      await selectors.sessionByTitle(page, titles[1]!).waitFor()
      await selectors.sessionByTitle(page, titles[0]!).click({ button: 'right' })
      await selectors.deleteSession(page).click()
      if (await selectors.confirmSessionDelete(page).isVisible())
        await selectors.confirmSessionDelete(page).click()
      await page.waitForURL((url) => decodeURIComponent(url.href).includes(ids[1]!))
      await step('delete-opens-first-surviving-project-session')
      ok(
        !(await readShell(page, base)).sessions.some((session) => session.id === ids[0]),
        'Deleted fixture must be absent from owner snapshot',
      )
    } finally {
      const remaining = await readShell(page, base)
      for (const sessionId of created) {
        if (!remaining.sessions.some((session) => session.id === sessionId)) continue
        await dispatch(page, base, { type: 'session.delete', sessionId })
      }
    }
  },
}
