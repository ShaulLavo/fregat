import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { holdToConfirm, selectors } from '../selectors'
import { dispatch, openChatWorkspace } from './chat-verification'
import { nativeLog, withConversationProvider } from './native-provider-verification'

export const checkpointRewind: Scenario = {
  name: 'checkpoint-rewind',
  requiresIsolatedServer: true,
  description:
    'Rewind one disposable conversation on the Codex conversation fixture, preserving and restoring composer text; the fixture thread drops the rewound turn. Removes its own session.',
  async run(page, { step }) {
    const shell = await openChatWorkspace(page)
    await withConversationProvider(page, shell.base, 'checkpoint-rewind', async (native) => {
      const sessionId = crypto.randomUUID()
      const title = `Rewind verification ${sessionId.slice(0, 8)}`
      const prompt =
        'Reply with exactly REWIND_VERIFIED. Do not use tools, inspect files or change files.'
      await dispatch(page, shell.base, {
        type: 'session.create',
        sessionId,
        title,
        worktreeTarget: { kind: 'current', worktreeId: shell.worktree.id },
        modelSelection: native.model,
      })
      try {
        await selectors.sessionSearch(page).fill(title)
        await selectors.sessionByTitle(page, title).click()
        await selectors.chatMessage(page).fill(prompt)
        await selectors.chatSend(page).click()
        await selectors
          .chatMessages(page)
          .getByText('REWIND_VERIFIED', { exact: true })
          .waitFor({ timeout: 90_000 })
        await selectors.chatSend(page).waitFor({ timeout: 30_000 })
        await selectors.chatMessage(page).fill('Keep this newer draft.')
        await step('completed-conversation-with-new-draft')
        await selectors.chatRewind(page).first().click({ force: true })
        await selectors.rewindDialog(page).waitFor()
        strictEqual(
          await selectors.rewindFiles(page).count(),
          0,
          'Shared checkouts do not offer file restore',
        )
        await page.waitForTimeout(250)
        await step('explicit-conversation-only-choice')
        await holdToConfirm(page, selectors.rewindConversation(page), () =>
          selectors.rewindDialog(page).waitFor({ state: 'hidden', timeout: 60_000 }),
        )
        strictEqual(
          (await selectors.chatMessage(page).innerText()).trim(),
          `${prompt}\n\nKeep this newer draft.`,
        )
        strictEqual(await selectors.chatRewind(page).count(), 0)
        const reverted = (await nativeLog(native.root)).filter((entry) => entry.event === 'revert')
        strictEqual(reverted.length, 1, 'The provider thread dropped the rewound turn')
        await step('history-rewound-and-draft-merged')
      } catch (error) {
        await step('rewind-failed-before-cleanup')
        throw error
      } finally {
        await dispatch(page, shell.base, { type: 'session.runtime.stop', sessionId })
        await dispatch(page, shell.base, { type: 'session.delete', sessionId })
      }
    })
  },
}
