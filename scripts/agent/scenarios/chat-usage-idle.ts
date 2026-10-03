import { strictEqual } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProviderUsageResult } from '../../../packages/contracts/src/index'
import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog, writeSettings } from './native-provider-verification'

export const chatUsageIdle = isolatedNativeScenario({
  name: 'chat-usage-idle',
  providerKind: 'claude',
  fixture: new URL('../fixtures/native-claude.mjs', import.meta.url),
  description:
    'An already-mounted idle composer receives its first lifecycle-collected native cache observation; cache GET bursts leave provider usage requests unchanged.',
  async drive(page, { root, orchestration, providerInstanceId, step }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    await writeSettings(page, base, [
      { kind: 'set', key: 'providers.usageRefreshSeconds', value: 60 },
    ])
    const meter = selectors.usageMeter(page)
    await meter.waitFor({ timeout: 30_000 })
    strictEqual(await meter.getAttribute('aria-label'), 'Account allowances · Unknown')
    await meter.click()
    await selectors
      .usagePopover(page)
      .getByText('No allowance observation', { exact: true })
      .waitFor()
    await step('mounted-idle-no-data')
    await page.keyboard.press('Escape')
    let before = await nativeLog(root)
    for (
      let attempt = 0;
      attempt < 50 && !before.some((event) => event.event === 'usage-read');
      attempt += 1
    ) {
      await Bun.sleep(100)
      before = await nativeLog(root)
    }
    const usageReadsBefore = before.filter((event) => event.event === 'usage-read').length
    strictEqual(usageReadsBefore > 0, true, 'fixture SDK usage counter is observable')
    strictEqual(
      before.filter((event) => event.event === 'turn').length,
      0,
      'no native turn before observation',
    )
    const observedAt = Date.now()
    // Only the external CLI cache changes; the browser keeps the same mounted composer.
    await writeFile(
      join(root, 'config', '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'isolated-usage-fixture', organizationType: 'max' },
        cachedUsageUtilization: {
          accountUuid: 'isolated-usage-fixture',
          fetchedAtMs: observedAt,
          utilization: {
            five_hour: {
              utilization: 19,
              resets_at: new Date(observedAt + 3_600_000).toISOString(),
            },
          },
        },
      }),
    )
    await meter
      .and(page.getByRole('button', { name: 'Account allowances · 19%', exact: true }))
      .waitFor({ timeout: 135_000 })
    await meter.click()
    const popover = selectors.usagePopover(page)
    await popover.getByText('19% used', { exact: true }).waitFor()
    await popover.getByText('Source: claude-local-cache', { exact: true }).waitFor()
    await step('first-background-observation')
    // Keep a scheduled SDK probe outside the GET-only counter measurement.
    await writeSettings(page, base, [
      { kind: 'set', key: 'providers.usageRefreshSeconds', value: 3600 },
    ])
    const usageReadsBeforeGetBurst = (await nativeLog(root)).filter(
      (event) => event.event === 'usage-read',
    ).length
    for (let index = 0; index < 6; index += 1) {
      const response = await page.request.get(`${base}/providers/usage`, {
        headers: { Origin: new URL(page.url()).origin },
      })
      strictEqual(response.status(), 200, 'cache-only account GET')
      const result = (await response.json()) as ProviderUsageResult
      const account = result.accounts.find((item) =>
        item.providerInstanceIds.some((id) => id === providerInstanceId),
      )
      strictEqual(
        account?.windows[0]?.usedPercent,
        19,
        'the explicit fixture account retains its observation',
      )
    }
    const after = await nativeLog(root)
    const usageReadsAfter = after.filter((event) => event.event === 'usage-read').length
    strictEqual(
      usageReadsAfter,
      usageReadsBeforeGetBurst,
      'cache account GETs make no SDK usage calls',
    )
    strictEqual(
      after.filter((event) => event.event === 'turn').length,
      0,
      'no native turn during idle observation',
    )
    await page.keyboard.press('Escape')
    await selectors.settingsOpen(page).click()
    await selectors.settingsSearch(page).fill('usage')
    await selectors.usageSection(page).getByText('No usage in the last 30 days').waitFor()
    await step('mounted-history-no-data')
    const transcripts = join(root, 'config', 'projects', 'outside-fregat-projects')
    await mkdir(transcripts, { recursive: true })
    await writeFile(
      join(transcripts, 'idle-history.jsonl'),
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: {
          id: 'isolated-native-history',
          model: 'isolated-unpriced-model',
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }) + '\n',
    )
    // A lifecycle scan settles the same mounted Settings view through its idle GET interval.
    await selectors
      .usageModelRows(page)
      .filter({ hasText: 'isolated-unpriced-model' })
      .waitFor({ timeout: 135_000 })
    await selectors.transcriptCoverage(page).getByText('1 files · 1 records').waitFor()
    await selectors.transcriptCoverage(page).scrollIntoViewIfNeeded()
    await step('first-background-transcript-observation')
    const historyResponse = await page.request.get(
      `${base}/providers/usage/history?days=30&utcOffsetMinutes=0`,
      { headers: { Origin: new URL(page.url()).origin } },
    )
    strictEqual(historyResponse.status(), 200, 'cache-only native history GET')
    const history = await historyResponse.json()
    strictEqual(history.totals.tokens, 120)
    strictEqual(history.coverage.accountAttribution, 'unverified')
    const usageReadsAfterHistory = (await nativeLog(root)).filter(
      (event) => event.event === 'usage-read',
    ).length
    strictEqual(
      usageReadsAfterHistory,
      usageReadsAfter,
      'history scan and GET leave SDK reads unchanged',
    )
    return {
      transport: 'real isolated server and native CLI fixture',
      nativeHistoryTokens: history.totals.tokens,
      nativeHistoryRecords: 1,
      mountedHistoryPolling: true,
      usageReadsAfterHistory,
      accountGetBurst: 6,
      idleCollectionCadenceSeconds: 60,
      getBurstCollectionCadenceSeconds: 3600,
      usageReadsBefore,
      usageReadsBeforeGetBurst,
      usageReadsAfter,
      nativeTurns: 0,
      firstObservationSource: 'claude-local-cache',
    }
  },
})
