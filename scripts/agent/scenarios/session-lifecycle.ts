import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChatShell, readShell } from './chat-verification'

export const sessionLifecycle: Scenario = {
  name: 'session-lifecycle',
  description:
    'Drive pin, settle, snooze, exact timer wake, bulk snooze and Undo in disposable sessions, then snooze a real running provider turn.',
  async run(page, { step }) {
    const { base, project, worktree } = await openChatShell(page)
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    const prefix = `Lifecycle verification ${first.slice(0, 8)}`
    const title = `${prefix} first`
    const other = `${prefix} second`
    for (const [sessionId, label] of [
      [first, title],
      [second, other],
    ])
      await dispatch(page, base, {
        type: 'session.create',
        sessionId,
        title: label,
        modelSelection: project.defaultModelSelection,
        worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      })
    const act = async (label: string) => {
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.sessionLifecycleAction(page, label).click()
    }
    try {
      await selectors.sessionSearch(page).fill(prefix)
      await act('Pin')
      await selectors.sessionInShelf(page, title, 'Pinned').waitFor()
      await step('pinned')
      await act('Mark as settled')
      await selectors.sessionInShelf(page, title, 'Settled').waitFor()
      await step('settle-clears-pin')
      await act('Move to active')
      await selectors.sessionInShelf(page, title, 'Active').waitFor()
      await act('Snooze…')
      strictEqual(await selectors.snoozeCustomSubmit(page).isEnabled(), false)
      await selectors.snoozeDurationMode(page).click()
      await selectors.snoozeAmount(page).fill('-1')
      strictEqual(await selectors.snoozeCustomSubmit(page).isEnabled(), false)
      await step('custom-snooze-dialog-invalid-duration')
      await selectors.snoozeAmount(page).fill('0.1')
      await selectors.snoozeCustomSubmit(page).click()
      await selectors.snoozeDialog(page).waitFor({ state: 'hidden' })
      await selectors.sessionInShelf(page, title, 'Snoozed').waitFor()
      await step('custom-six-second-snooze')
      await selectors.sessionInShelf(page, title, 'Active').waitFor({ timeout: 10_000 })
      await step('timer-moves-session-without-an-event')
      await selectors.sessionByTitle(page, title).click()
      await selectors.sessionByTitle(page, other).click({ modifiers: ['Shift'] })
      await step('bulk-toolbar-at-rail-width')
      await selectors.sessionBulkActions(page).click()
      await selectors.sessionLifecycleAction(page, 'Snooze…').click()
      await selectors.snoozePreset(page).click()
      await selectors.snoozeDialog(page).waitFor({ state: 'hidden' })
      await selectors.sessionInShelf(page, title, 'Snoozed').waitFor()
      await selectors.sessionInShelf(page, other, 'Snoozed').waitFor()
      await step('bulk-snoozed')
      await selectors.toastUndo(page).click()
      await selectors.sessionInShelf(page, title, 'Active').waitFor()
      await selectors.sessionInShelf(page, other, 'Active').waitFor()
      await step('bulk-undo')
      await selectors.sessionByTitle(page, title).click()
      await selectors
        .chatMessage(page)
        .fill(
          'Think carefully about why 97 is prime, then reply with exactly LIFECYCLE_VERIFIED. Do not use tools or change files.',
        )
      await selectors.chatSend(page).click()
      await act('Snooze…')
      strictEqual(
        (await readShell(page, base)).sessions.find((session) => session.id === first)?.runtime
          ?.status,
        'running',
        'Provider must still be running when snooze is chosen',
      )
      await selectors.snoozePreset(page).click()
      await selectors.snoozeDialog(page).waitFor({ state: 'hidden' })
      const running = (await readShell(page, base)).sessions.find((session) => session.id === first)
      ok(running?.snoozedUntil, 'Running session snooze must be accepted')
      await step('provider-session-snoozed')
      await act('Unsnooze')
      await selectors.sessionInShelf(page, title, 'Active').waitFor()
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId: first })
      await dispatch(page, base, { type: 'session.delete', sessionId: second })
    }
  },
}
