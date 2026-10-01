import { connectSecondOwner } from '../second-owner'
import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { holdToConfirm, selectors } from '../selectors'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { collectOrchestrationBases, dispatch, openChat, readShell } from './chat-verification'
import { isDraftChatUrl } from './draft-sessions'
import { registerFixtureProject, installConversationProvider } from './native-provider-verification'

export const sessionNavigation: Scenario = {
  name: 'session-navigation',
  description:
    'Archive the current session into its project draft, preserve a background archive route, and delete into the first surviving session. Uses three sessions in a disposable project.',
  async run(page, { step }) {
    let failedArchiveId: string | null = null
    let interruptions = 0
    await page.routeWebSocket(
      (url) => url.pathname.endsWith('/orchestration/rpc'),
      (socket) => {
        const server = socket.connectToServer()
        socket.onMessage((message) => {
          const text = message.toString()
          if (
            failedArchiveId &&
            text.includes('session.archive') &&
            text.includes(failedArchiveId)
          ) {
            failedArchiveId = null
            interruptions++
            void socket.close({ code: 1001, reason: 'Fixture archive transport interrupted' })
            void server.close({ code: 1001, reason: 'Fixture archive transport interrupted' })
            return
          }
          server.send(message)
        })
      },
    )
    const bases = collectOrchestrationBases(page)
    const base = await openChat(page)
    const remote = await connectSecondOwner(page, bases)
    const remoteBase = `${remote.origin}/orchestration`
    const root = await createGitFixture('session-navigation')
    await fixtureGit(root, ['commit', '--quiet', '-m', 'fixture'])
    const worktree = await registerFixtureProject(page, base, root)
    const remoteWorktree = await registerFixtureProject(page, remoteBase, root)
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    const prefix = `Navigation verification ${ids[0]!.slice(0, 8)}`
    const titles = ids.map((_, index) => `${prefix} ${index + 1}`)
    const created: string[] = []
    const native = await installConversationProvider(page, base, 'navigation-local')
    const remoteNative = await installConversationProvider(page, remoteBase, 'navigation-remote')
    try {
      for (const [index, sessionId] of ids.entries()) {
        await dispatch(page, base, {
          type: 'session.create',
          sessionId,
          title: titles[index],
          modelSelection: native.model,
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        })
        created.push(sessionId)
      }
      const remoteTitle = `${prefix} remote twin`
      await dispatch(page, remoteBase, {
        type: 'session.create',
        sessionId: ids[0],
        title: remoteTitle,
        modelSelection: remoteNative.model,
        worktreeTarget: { kind: 'current', worktreeId: remoteWorktree.id },
      })
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionByTitle(page, remoteTitle).click()
      await page.waitForURL((url) => url.href.includes(ids[0]!) && url.pathname.includes('/@'))
      const remoteRoute = new URL(page.url()).pathname
      await selectors.sessionByTitle(page, titles[0]!).click({ button: 'right' })
      await selectors.archiveSession(page).click()
      await selectors.sessionByTitle(page, titles[0]!).waitFor({ state: 'hidden' })
      strictEqual(
        new URL(page.url()).pathname,
        remoteRoute,
        'Archiving the same-id row on another owner preserves the viewed route',
      )
      strictEqual(
        (await readShell(page, remoteBase)).sessions.find((session) => session.id === ids[0])
          ?.archivedAt,
        null,
      )
      await step('same-id-background-archive-keeps-remote-route')
      await dispatch(page, base, { type: 'session.unarchive', sessionId: ids[0] })
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
      await page.waitForURL((url) => url.href.includes(ids[1]!) && !url.pathname.includes('/@'))
      const beforeFailedArchive = new URL(page.url()).pathname
      failedArchiveId = ids[1]!
      await selectors.sessionByTitle(page, titles[1]!).click({ button: 'right' })
      await selectors.archiveSession(page).click()
      await selectors.toast(page, 'Session command failed').waitFor()
      strictEqual(interruptions, 1)
      strictEqual(new URL(page.url()).pathname, beforeFailedArchive)
      strictEqual(
        (await readShell(page, base)).sessions.find((session) => session.id === ids[1])?.archivedAt,
        null,
      )
      await selectors.sessionByTitle(page, titles[1]!).waitFor()
      await step('failed-current-archive-keeps-route-and-row')
      await selectors.sessionByTitle(page, titles[1]!).click({ button: 'right' })
      await selectors.archiveSession(page).click()
      await page.waitForURL(isDraftChatUrl)
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
      const landed = () => page.waitForURL((url) => decodeURIComponent(url.href).includes(ids[1]!))
      if (await selectors.confirmSessionDelete(page).isVisible())
        await holdToConfirm(page, selectors.confirmSessionDelete(page), landed)
      await landed()
      await selectors.sessionByTitle(page, remoteTitle).waitFor()
      strictEqual(
        (await readShell(page, remoteBase)).sessions.find((session) => session.id === ids[0])
          ?.archivedAt,
        null,
      )
      await step('delete-opens-owning-survivor-keeps-remote-twin')
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
      await dispatch(page, base, {
        type: 'project.delete',
        projectId: worktree.projectId,
        force: true,
      })
      await native.remove()
      await remoteNative.remove()
      await page.goto('about:blank')
      await remote.stop()
      await releaseFixture(root)
    }
  },
}
