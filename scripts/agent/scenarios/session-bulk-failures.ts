import { ok, strictEqual } from 'node:assert/strict'
import { connectSecondOwner } from '../second-owner'
import { holdToConfirm, selectors } from '../selectors'
import {
  collectOrchestrationBases,
  dispatch,
  openChatWorkspace,
  readShell,
} from './chat-verification'
import { registerFixtureProject, installConversationProvider } from './native-provider-verification'
import type { Scenario } from './index'

export const sessionBulkFailures: Scenario = {
  name: 'session-bulk-failures',
  requiresIsolatedServer: true,
  description:
    'Interrupt one remote command in a three-row batch: snooze clears selection and Undo restores successes; delete retains the failed row and removes both successful rows.',
  async run(page, { step }) {
    const failedId = crypto.randomUUID()
    let interrupt: 'session.snooze' | 'session.delete' | null = null
    let interruptions = 0
    await page.routeWebSocket(
      (url) => url.pathname.endsWith('/orchestration/rpc'),
      (socket) => {
        const server = socket.connectToServer()
        socket.onMessage((message) => {
          const text = message.toString()
          if (interrupt && text.includes(interrupt) && text.includes(failedId)) {
            interrupt = null
            interruptions++
            void socket.close({ code: 1001, reason: 'Fixture command transport interrupted' })
            void server.close({ code: 1001, reason: 'Fixture command transport interrupted' })
            return
          }
          server.send(message)
        })
      },
    )
    const bases = collectOrchestrationBases(page)
    const workspace = await openChatWorkspace(page)
    const remote = await connectSecondOwner(page, bases)
    const remoteBase = `${remote.origin}/orchestration`
    const remoteWorktree = await registerFixtureProject(
      page,
      remoteBase,
      workspace.worktree.canonicalPath,
    )
    const prefix = `Bulk failures ${failedId.slice(0, 8)}`
    const rows = [
      {
        id: crypto.randomUUID(),
        title: `${prefix} first`,
        base: workspace.base,
        worktree: workspace.worktree,
        key: 'g',
      },
      {
        id: failedId,
        title: `${prefix} middle remote`,
        base: remoteBase,
        worktree: remoteWorktree,
        key: 'n',
      },
      {
        id: crypto.randomUUID(),
        title: `${prefix} last`,
        base: workspace.base,
        worktree: workspace.worktree,
        key: 't',
      },
    ] as const
    const mark = async () => {
      await selectors.sessionByTitle(page, rows[0].title).click()
      await selectors.sessionByTitle(page, rows[2].title).click({ modifiers: ['Shift'] })
    }
    const localNative = await installConversationProvider(page, workspace.base, 'bulk-local')
    const remoteNative = await installConversationProvider(page, remoteBase, 'bulk-remote')
    try {
      for (const row of rows) {
        await dispatch(page, row.base, {
          type: 'session.create',
          sessionId: row.id,
          title: row.title,
          modelSelection: row.base === workspace.base ? localNative.model : remoteNative.model,
          worktreeTarget: { kind: 'current', worktreeId: row.worktree.id },
        })
        await dispatch(page, row.base, {
          type: 'session.pin',
          sessionId: row.id,
          orderKey: row.key,
        })
      }
      await selectors.sessionSearch(page).fill(prefix)
      await mark()
      await selectors.sessionBulkActions(page).click()
      await selectors.sessionLifecycleAction(page, 'Snooze…').click()
      interrupt = 'session.snooze'
      await selectors.snoozePreset(page).click()
      await selectors.sessionInShelf(page, rows[0].title, 'Snoozed').waitFor()
      await selectors.sessionInShelf(page, rows[2].title, 'Snoozed').waitFor()
      await selectors.sessionInShelf(page, rows[1].title, 'Pinned').waitFor()
      await selectors.selectedSessionsToolbar(page).waitFor({ state: 'hidden' })
      strictEqual(interruptions, 1)
      await step('partial-snooze-clears-selection')
      await selectors.toastUndo(page, '2 snoozed, 1 failed').click()
      await selectors.sessionInShelf(page, rows[0].title, 'Pinned').waitFor()
      await selectors.sessionInShelf(page, rows[2].title, 'Pinned').waitFor()
      strictEqual(
        (await readShell(page, remoteBase)).sessions.find((session) => session.id === failedId)
          ?.snoozedUntil,
        null,
      )
      await step('undo-restores-successful-snoozes-only')
      await mark()
      interrupt = 'session.delete'
      await selectors.sessionBulkActions(page).click()
      await selectors.sessionLifecycleAction(page, 'Delete').click()
      await selectors.confirmSessionDelete(page).waitFor()
      await holdToConfirm(page, selectors.confirmSessionDelete(page), () =>
        selectors.confirmSessionDelete(page).waitFor({ state: 'hidden' }),
      )
      await selectors.sessionByTitle(page, rows[0].title).waitFor({ state: 'hidden' })
      await selectors.sessionByTitle(page, rows[2].title).waitFor({ state: 'hidden' })
      await selectors.markedSession(page, rows[1].title).waitFor()
      strictEqual(interruptions, 2)
      ok((await readShell(page, remoteBase)).sessions.some((session) => session.id === failedId))
      await step('partial-delete-retains-only-failed-remote-row')
    } finally {
      const remaining = await readShell(page, workspace.base)
      for (const row of rows) {
        if (
          row.base !== workspace.base ||
          !remaining.sessions.some((session) => session.id === row.id)
        )
          continue
        await dispatch(page, workspace.base, { type: 'session.delete', sessionId: row.id })
      }
      await localNative.remove()
      await remoteNative.remove()
      await page.goto('about:blank')
      await remote.stop()
    }
  },
}
