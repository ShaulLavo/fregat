import { deepStrictEqual, strictEqual } from 'node:assert/strict'

import { selectors } from '../selectors'
import {
  draftFixture,
  openIsolatedDraft,
  releaseStartedSessions,
  startedSessions,
} from './draft-sessions'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

const PROMPT = 'Compare these two models.'

/** Plan 126 INTERACTION-08: one draft sent to two models starts two sessions on two worktrees. */
export const chatMultipleModels = isolatedNativeScenario({
  name: 'chat-multiple-models',
  description:
    'In a new draft, Shift+select a second model and send: two sessions start, each on its own new worktree, each with the same prompt on its own model. Deletes the sessions and releases their worktrees.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  prepareWorktree: () => draftFixture('multiple-models'),
  async drive(page, { step, orchestration, sessionId, projectId, providerInstanceId, root }) {
    await openIsolatedDraft(page, { orchestration, projectId, providerInstanceId })
    await selectors.modelPickerTrigger(page).click()
    const panel = selectors.modelPickerPanel(page)
    await panel.waitFor({ timeout: 10_000 })
    await selectors.modelPickerOption(page, 'gpt-5.5-mini').click({ modifiers: ['Shift'] })
    await page.keyboard.press('Escape')
    await selectors.modelPickerTrigger(page).getByText('+1', { exact: true }).waitFor()
    await step('two-models-selected')

    await sendPrompt(page, PROMPT)
    let starts: Awaited<ReturnType<typeof nativeLog>> = []
    for (let attempt = 0; attempt < 100 && starts.length < 2; attempt += 1) {
      starts = (await nativeLog(root)).filter((entry) => entry.event === 'turn/start')
      await Bun.sleep(200)
    }
    deepStrictEqual(
      starts.map((entry) => String(entry.model)).toSorted(),
      ['gpt-5.5', 'gpt-5.5-mini'],
      'Each model got the turn',
    )
    const started = await startedSessions(page, orchestration, { count: 2, projectId, sessionId })
    strictEqual(new Set(started.map((session) => session.worktreeId)).size, 2)
    await selectors
      .chatMessages(page)
      .getByText(/^MULTIPLE_MODELS /)
      .waitFor({ timeout: 30_000 })
    await step('two-sessions-started')
    strictEqual(
      await page.getByText('Drafts', { exact: true }).count(),
      0,
      'The sent draft leaves no recoverable copy behind',
    )

    await releaseStartedSessions(page, orchestration, started)
  },
})
