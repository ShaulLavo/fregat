import { ok, strictEqual } from 'node:assert/strict'
import * as v from 'valibot'
import { providerUsageSessionTotalSchema } from '../../../packages/contracts/src/index'
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
        const sessionId = await openSession('Context popover')
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
        const cache = selectors.sessionCacheDetails(page)
        await cache.getByText('1 turn', { exact: true }).waitFor({ timeout: 15_000 })
        await cache.getByText('Read', { exact: true }).waitFor()
        await cache.getByText('Written', { exact: true }).waitFor()
        await cache.getByText('No reported cache reads or writes.', { exact: true }).waitFor()
        strictEqual(
          await cache
            .locator('dd')
            .allTextContents()
            .then((texts) => texts.join(',')),
          '0,0,—',
        )
        const response = await page.request.get(
          `${orchestration.replace(/\/orchestration$/, '')}/providers/usage/sessions/${sessionId}`,
          {
            headers: { Origin: new URL(page.url()).origin },
          },
        )
        ok(response.ok(), 'The session usage route reads the actual recorded fixture turn')
        const total = v.parse(providerUsageSessionTotalSchema, await response.json())
        strictEqual(total.cache?.turns.length, 1)
        strictEqual(total.cache?.turns[0]?.readTokens, 0)
        strictEqual(total.cache?.turns[0]?.writeTokens, 0)
        ok(
          total.cache?.turns[0]?.startedAt && total.cache.turns[0].completedAt,
          'Existing projected turn timestamps are joined',
        )
        ok(
          !JSON.stringify(total.cache).includes('cacheRebuild'),
          'A first turn adds factual counters without a rebuild classification',
        )
        await settleAnimations(popover)
        await step('context-popover')
      },
    ),
}
