import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { readShell, dispatch } from './chat-verification'

export const checkpointRewind: Scenario = {
  name: 'checkpoint-rewind',
  description:
    'Rewind one disposable real-provider conversation, preserving and restoring composer text. Uses provider tokens and removes its own session.',
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
    const title = `Rewind verification ${sessionId.slice(0, 8)}`
    const prompt =
      'Reply with exactly REWIND_VERIFIED. Do not use tools, inspect files or change files.'
    await dispatch(page, base, {
      type: 'session.create',
      sessionId,
      title,
      worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      modelSelection: project.defaultModelSelection,
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
      await selectors.rewindConversation(page).click()
      await selectors.rewindDialog(page).waitFor({ state: 'hidden', timeout: 60_000 })
      strictEqual(
        (await selectors.chatMessage(page).innerText()).trim(),
        `${prompt}\n\nKeep this newer draft.`,
      )
      strictEqual(await selectors.chatRewind(page).count(), 0)
      await step('history-rewound-and-draft-merged')
    } catch (error) {
      await step('rewind-failed-before-cleanup')
      throw error
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId })
    }
  },
}
