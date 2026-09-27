import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors, settleAnimations } from '../selectors'
import { typePrompt, waitForReply } from './chat-verification'
import { runInFixtureRepository } from './fixture-repository'

const DONE = 'CONTEXT_READY'

export const claudeContextPopover: Scenario = {
  name: 'claude-context-popover',
  requiresIsolatedServer: true,
  description:
    "The Claude fixture, one turn: the context ring's popover shows what fills the window by category from get_context_usage, the deferred tools apart, and this session's tokens and cost. Removes the fixture, session and project.",
  run: (page, { step }) =>
    runInFixtureRepository(
      page,
      step,
      { kind: 'claude', name: 'claude-context-popover' },
      async ({ orchestration, openSession }) => {
        // The meter is off by default; this server's state is thrown away after the run.
        const settings = await page.request.post(
          `${orchestration.replace(/\/orchestration$/, '/settings')}/write`,
          {
            headers: { Origin: new URL(page.url()).origin },
            data: {
              mutationId: crypto.randomUUID(),
              target: 'user',
              operations: [{ kind: 'set', key: 'chat.contextWindowMeterEnabled', value: true }],
            },
          },
        )
        ok(settings.ok(), 'The context meter setting is written')
        await openSession('Context popover')
        await typePrompt(page, `Use no tools. Reply with exactly ${DONE}.`)
        await selectors.chatSend(page).click()
        await waitForReply(page, DONE)

        const ring = page.getByRole('button', { name: /^Context \d+% full$/ }).first()
        await ring.waitFor({ timeout: 30_000 })
        await ring.click()
        const popover = page.getByRole('dialog').filter({ hasText: 'Context window' })
        await popover.getByRole('meter', { name: 'Context window by category' }).waitFor()
        await popover.getByText('Messages', { exact: true }).waitFor()
        await popover.getByText(/^\d[\d.]*k? tokens ·/).waitFor({ timeout: 15_000 })
        await settleAnimations(popover)
        await step('context-popover')
      },
    ),
}
