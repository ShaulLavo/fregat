import { scratchPath } from '../paths'
import { ok, strictEqual } from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { openChat } from './chat-verification'
import {
  assertFixtureProviders,
  registerFixtureProject,
  writeSettings,
} from './native-provider-verification'
import { providerUsageHistorySchema } from '../../../packages/contracts/src/index'
import type { Scenario } from './index'

const LABEL = 'Claude import fixture'
const MODEL = 'claude-haiku-4-5'

/** Two prompts, the first answered twice over one API response (one row per content block). */
function transcript(sessionId: string, cwd: string, model = MODEL, refreshed = false) {
  const now = Date.now()
  const at = (seconds: number) => new Date(now - 60_000 + seconds * 1000).toISOString()
  const base = {
    cwd,
    entrypoint: 'cli',
    gitBranch: 'main',
    isSidechain: false,
    sessionId,
    userType: 'external',
    version: '2.1.282',
  }
  const prompt = (uuid: string, parentUuid: string | null, text: string, seconds: number) => ({
    ...base,
    message: { content: text, role: 'user' },
    parentUuid,
    timestamp: at(seconds),
    type: 'user',
    uuid,
  })
  const answer = (uuid: string, parentUuid: string, id: string, seconds: number) => ({
    ...base,
    message: {
      content: [{ text: 'Done.', type: 'text' }],
      id: `${sessionId}-${id}`,
      model,
      role: 'assistant',
      type: 'message',
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: refreshed ? 2_000_000 : 1_000_000,
        input_tokens: 1000,
        output_tokens: refreshed ? 1000 : 500,
      },
    },
    parentUuid,
    requestId: `req-${sessionId}-${id}`,
    timestamp: at(seconds),
    type: 'assistant',
    uuid,
  })
  const rows = [
    prompt('u1', null, 'Count the files', 0),
    answer('a1', 'u1', 'msg-1', 1),
    answer('a1b', 'a1', 'msg-1', 2),
    prompt('u2', 'a1b', 'Now count the folders', 10),
    answer('a2', 'u2', 'msg-2', 11),
  ]
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
}

export const claudeUsageImport: Scenario = {
  name: 'claude-usage-import',
  description:
    'Native fixture transcripts flow through import, recorded history and Usage: cache savings follow saved rates, unknown models stay unavailable, and rescanning existing chats updates usage before and after reload.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const base = orchestration.replace(/\/orchestration$/, '')
    await assertFixtureProviders(page, base)
    const fixture = await realpath(await createGitFixture('claude-usage-import'))
    const configDir = await mkdtemp(scratchPath('fregat-claude-usage-import-config-'))
    try {
      const project = join(configDir, 'projects', fixture.replace(/[^a-zA-Z0-9]/g, '-'))
      await mkdir(project, { recursive: true })
      const sessionId = crypto.randomUUID()
      const unknownSessionId = crypto.randomUUID()
      await writeFile(join(project, `${sessionId}.jsonl`), transcript(sessionId, fixture))
      await writeFile(
        join(project, `${unknownSessionId}.jsonl`),
        transcript(unknownSessionId, fixture, 'unknown-model'),
      )
      // Import reads transcripts from the config folder; the instance never runs a CLI.
      const binary = join(configDir, 'claude')
      await writeFile(binary, '#!/bin/sh\nexit 1\n')
      await chmod(binary, 0o755)
      // This server's state is thrown away after the run.
      await writeSettings(page, base, [
        {
          kind: 'provider.setEnabled',
          providerInstanceId: 'claude-import-fixture',
          enabled: true,
          createIfMissing: {
            binaryPath: binary,
            config: { configDir },
            displayLabel: LABEL,
            driverKind: 'claude',
          },
        },
      ])
      await assertFixtureProviders(page, base, binary)
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await registerFixtureProject(page, orchestration, fixture)

      await page.goto(page.url().replace(/\/chat(?:\?.*)?$/, '/workbench'))
      await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('import')
      const row = page
        .locator('div')
        .filter({ has: page.getByText(LABEL, { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Import from Claude Code' }) })
        .last()
      await row.getByRole('button', { name: 'Import from Claude Code' }).click()
      await page
        .getByRole('status')
        .getByText(/^2 chats imported/)
        .waitFor({ timeout: 30_000 })
      await step('imported')

      const history = async () => {
        const response = await page.request.get(
          `${base}/providers/usage/history?days=30&utcOffsetMinutes=0`,
          { headers: { Origin: new URL(page.url()).origin } },
        )
        ok(response.ok(), `Usage history returned ${response.status()}`)
        return v.parse(providerUsageHistorySchema, await response.json())
      }
      const verify = async (refreshed: boolean) => {
        const result = await history()
        const model = result.models.find((entry) => entry.model === MODEL)
        const unknown = result.models.find((entry) => entry.model === 'unknown-model')
        ok(
          model?.rates?.cacheRead !== null && model?.rates,
          'The known model has recorded cache rates',
        )
        strictEqual(model.inputTokens, 2000, 'Duplicate content blocks are billed once')
        strictEqual(model.outputTokens, refreshed ? 2000 : 1000)
        strictEqual(model.cacheReadTokens, refreshed ? 4_000_000 : 2_000_000)
        strictEqual(model.turns, 2)
        strictEqual(unknown?.costUsd, null)
        strictEqual(unknown?.rates, null)
        strictEqual(result.totals.turns, 4, 'Rescanning existing chats keeps their turn count')
        strictEqual(result.totals.unpricedTokens, 2_003_000)
        const cost =
          (model.inputTokens * model.rates.input +
            model.outputTokens * model.rates.output +
            model.cacheReadTokens * model.rates.cacheRead) /
          1_000_000
        ok(Math.abs(model.costUsd! - cost) < 1e-9, 'Recorded cost follows its saved rates')
        const savings =
          (model.cacheReadTokens * (model.rates.input - model.rates.cacheRead)) / 1_000_000
        await selectors.settingsSearch(page).fill('usage')
        await selectors
          .usageSummary(page)
          .getByText(`Cache savings $${savings.toFixed(2)}`, { exact: true })
          .waitFor()
        await selectors.usageSection(page).getByText('Price unavailable', { exact: true }).waitFor()
        await selectors
          .usageSummary(page)
          .getByText(/Excludes .* cached tokens/)
          .waitFor()
        await step(refreshed ? 'rescanned-usage-page' : 'actual-history-usage-page')
        return result
      }
      const before = await verify(false)
      await writeFile(
        join(project, `${sessionId}.jsonl`),
        transcript(sessionId, fixture, MODEL, true),
      )
      await selectors.settingsSearch(page).fill('import')
      const refresh = page.waitForResponse(
        (response) =>
          response.url().endsWith('/orchestration/session-import') &&
          response.request().method() === 'POST',
      )
      await row.getByRole('button', { name: 'Import from Claude Code' }).click()
      ok((await refresh).ok(), 'The real rescan request succeeds')
      await page
        .getByRole('status')
        .getByText(/0 chats imported/)
        .waitFor({ timeout: 30_000 })
      await step('refreshed-existing-transcripts')
      const after = await verify(true)
      ok(after.totals.tokens > before.totals.tokens, 'Rescan records the additional tokens')
      await page.reload()
      await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
      await page.keyboard.press('Control+,')
      await verify(true)
    } finally {
      await rm(configDir, { force: true, recursive: true })
      await releaseFixture(fixture)
    }
  },
}
