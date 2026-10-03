import { equal, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import * as v from 'valibot'
import { healthDescriptorSchema } from '../../../packages/contracts/src/health'
import type { Evidence } from '../evidence'
import { selectors, waitForSessionWorkspace } from '../selectors'
import { readShell, typePrompt, waitForCompletedTurn } from './chat-verification'
import { runInFixtureRepository, type FixtureRepository } from './fixture-repository'
import type { Scenario } from './index'
import { nativeLog } from './native-provider-verification'

export const monitorDraftOwnership: Scenario = {
  name: 'monitor-draft-ownership',
  requiresIsolatedServer: true,
  description:
    'A monitoring session retains its own unsent draft while another session submits once and reloads with an empty composer.',
  run: (page, { step, evidence }) =>
    runInFixtureRepository(
      page,
      step,
      { kind: 'claude', name: 'background-monitor-liveness' },
      (repository) => drive(page, repository, evidence, step),
    ),
}

async function drive(
  page: Page,
  repository: FixtureRepository,
  evidence: Evidence,
  step: (label: string) => Promise<void>,
) {
  const { native, orchestration, fixture, openSession } = repository
  const health = await page.request.get(`${orchestration.replace(/\/orchestration$/, '')}/health`, {
    headers: { Origin: new URL(page.url()).origin },
  })
  ok(health.ok(), 'Fixture health is reachable')
  const { environmentId } = v.parse(healthDescriptorSchema, await health.json())
  const first = await openSession('Monitor draft owner')
  const firstTitle = `Monitor draft owner ${first.slice(0, 8)}`
  await waitForSessionWorkspace(page, first, fixture, environmentId)
  const firstPrompt = 'Reply with exactly MONITOR_DRAFT_FIRST.'
  await typePrompt(page, firstPrompt)
  equal((await selectors.chatMessage(page).innerText()).trim(), firstPrompt)
  await step('known-good-first-draft-visible')
  await selectors.chatSend(page).click()
  await waitForCompletedTurn(page, orchestration, first)
  await emptyComposer(page)
  await writeFile(join(native.root, 'background-step'), 'monitor')
  await selectors.sessionStatus(page, firstTitle, 'Monitoring').waitFor()
  const unsent = 'Unsent draft belongs only to the monitoring session.'
  await typePrompt(page, unsent)
  await step('monitoring-with-owned-unsent-draft')

  const second = await openSession('Fresh draft owner')
  const secondTitle = `Fresh draft owner ${second.slice(0, 8)}`
  await waitForSessionWorkspace(page, second, fixture, environmentId)
  await emptyComposer(page)
  await step('new-session-has-empty-composer')
  const secondPrompt = 'Reply with exactly MONITOR_DRAFT_SECOND.'
  await typePrompt(page, secondPrompt)
  await selectors.chatSend(page).click()
  await waitForCompletedTurn(page, orchestration, second)
  await emptyComposer(page)
  await page.reload()
  await waitForSessionWorkspace(page, second, fixture, environmentId)
  await emptyComposer(page)
  await step('second-submit-once-empty-after-reload')

  await selectors.sessionSearch(page).fill(firstTitle)
  await selectors.sessionByTitle(page, firstTitle).click()
  await waitForSessionWorkspace(page, first, fixture, environmentId)
  await selectors.chatMessage(page).filter({ hasText: unsent }).waitFor()
  equal((await selectors.chatMessage(page).innerText()).trim(), unsent)
  await step('original-monitor-draft-preserved')
  await selectors.sessionSearch(page).fill('')
  equal(await selectors.sessionByTitle(page, firstTitle).count(), 1)
  equal(await selectors.sessionByTitle(page, secondTitle).count(), 1)
  const turns = (await nativeLog(native.root)).filter((entry) => entry.event === 'turn')
  equal(turns.length, 2)
  equal(turns[0]?.prompt, firstPrompt)
  equal(turns[1]?.prompt, secondPrompt)
  const shell = await readShell(page, orchestration)
  equal(shell.sessions.find((session) => session.id === first)?.backgroundLiveness, 'monitoring')
  await evidence.json('draft-ownership.json', {
    environmentId,
    fixture,
    first,
    second,
    nativeTurnCount: turns.length,
    prompts: turns.map((turn) => turn.prompt),
    retainedDraft: unsent,
    secondComposerEmptyAfterReload: true,
    duplicateRailRows: false,
  })
  await step('two-owners-no-duplicate-turn-or-row')
}

async function emptyComposer(page: Page) {
  await selectors.chatMessage(page).filter({ hasText: /^\s*$/ }).waitFor()
  equal((await selectors.chatMessage(page).innerText()).trim(), '')
}
