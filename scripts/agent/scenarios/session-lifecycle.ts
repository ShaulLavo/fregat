import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChatWorkspace, readShell, waitForCompletedTurn } from './chat-verification'
import { holdTurns, withConversationProvider } from './native-provider-verification'

export const sessionLifecycle: Scenario = {
  name: 'session-lifecycle',
  requiresIsolatedServer: true,
  description:
    'Drive pin, settle, snooze, exact timer wake, bulk snooze and Undo in disposable sessions, then snooze a turn the Codex conversation fixture holds running.',
  async run(page, { step }) {
    const { base, worktree } = await openChatWorkspace(page)
    await withConversationProvider(page, base, 'session-lifecycle', async (native) => {
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
          modelSelection: native.model,
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
        const held = await holdTurns(native)
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
        const running = (await readShell(page, base)).sessions.find(
          (session) => session.id === first,
        )
        ok(running?.snoozedUntil, 'Running session snooze must be accepted')
        await step('provider-session-snoozed')
        await act('Unsnooze')
        await selectors.sessionInShelf(page, title, 'Active').waitFor()
        await held.release()
        await selectors
          .chatMessages(page)
          .getByText('LIFECYCLE_VERIFIED', { exact: true })
          .waitFor({ timeout: 30_000 })
        await waitForCompletedTurn(page, base, first)
        await step('held-turn-completes')
      } finally {
        for (const sessionId of [first, second]) {
          await dispatch(page, base, { type: 'session.runtime.stop', sessionId })
          await dispatch(page, base, { type: 'session.delete', sessionId })
        }
      }
    })
  },
}
