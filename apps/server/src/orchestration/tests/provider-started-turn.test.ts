import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import {
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  DEFAULT_INTERACTION_MODE,
  PROVIDER_TURN_STARTED_ACTIVITY_KIND,
  sessionIdSchema,
} from '@workspace/contracts'
import { afterEach, expect, onTestFinished, test } from 'vitest'
import * as v from 'valibot'
import { resolveFakeClaudeExecutable, SYNTHETIC_OPUS } from '../../../test/factories/claude-models'
import {
  assistantText,
  commandLifecycle,
  FAKE_CLAUDE_SESSION_ID,
  FakeClaudeQuery,
  fakeClaudeInit,
  fakeClaudeSuccess,
  signedInClaudeAuth,
} from '../../../test/factories/fake-claude-query'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
  mockRuntime,
  sessionFrom,
} from '../../../test/factories/orchestration'
import { ClaudeProviderAdapter } from '../../provider/adapters/claude'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import type { ProviderRuntimeEvent } from '../../provider/types'
import { ProviderRuntimeIngestion } from '../provider-runtime-ingestion'

const fixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function sessionWithFinishedTurn(adapter: MockProviderAdapter) {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  await fixture.restart(mockRuntime(adapter))
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing worktree registration')
  await fixture.createSession(registration.result.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  return fixture
}

test('a turn the harness starts becomes the running turn, keeps its reply and settles', async () => {
  const adapter = new MockProviderAdapter()
  const fixture = await sessionWithFinishedTurn(adapter)
  const wakeup = adapter.startProviderTurn({
    origin: 'scheduled',
    sessionId: v.parse(sessionIdSchema, FIXTURE_SESSION_ID),
  })
  await fixture.engine.providerRuntimeIdle()

  const running = await sessionFrom(fixture)
  expect(running.latestTurn).toMatchObject({
    providerStartState: 'adopted',
    state: 'running',
    turnId: wakeup.turnId,
  })
  expect(running.runtime).toMatchObject({ activeTurnId: wakeup.turnId, status: 'running' })
  expect(running.activities).toContainEqual(
    expect.objectContaining({
      kind: PROVIDER_TURN_STARTED_ACTIVITY_KIND,
      summary: 'Scheduled wake-up',
      turnId: wakeup.turnId,
    }),
  )
  // The owner's next prompt waits for the harness turn instead of racing it.
  await expect(fixture.startTurn(FIXTURE_SESSION_ID, 'turn-2')).rejects.toMatchObject({
    code: 'orchestration.START_STATE_CONFLICT',
  })

  wakeup.finish('AWAKE')
  await fixture.engine.providerRuntimeIdle()
  const settled = await sessionFrom(fixture)
  expect(settled.latestTurn).toMatchObject({
    providerStartState: 'settled',
    state: 'completed',
    turnId: wakeup.turnId,
  })
  expect(settled.messages).toContainEqual(
    expect.objectContaining({ role: 'assistant', text: 'AWAKE', turnId: wakeup.turnId }),
  )

  await fixture.startTurn(FIXTURE_SESSION_ID, 'turn-2')
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    state: 'completed',
    turnId: 'turn-2',
  })
})

test('a harness turn that starts while a requested turn runs stays out of the log', async () => {
  const adapter = new MockProviderAdapter()
  const fixture = await sessionWithFinishedTurn(adapter)
  const sessionId = v.parse(sessionIdSchema, FIXTURE_SESSION_ID)
  const first = adapter.startProviderTurn({ origin: 'task', sessionId })
  await fixture.engine.providerRuntimeIdle()
  const second = adapter.startProviderTurn({ origin: 'scheduled', sessionId })
  await fixture.engine.providerRuntimeIdle()

  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    state: 'running',
    turnId: first.turnId,
  })
  expect(second.turnId).not.toBe(first.turnId)
  first.finish('done')
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    state: 'completed',
    turnId: first.turnId,
  })
})

/** What the Claude adapter emits, from an idle runtime, for a wakeup that runs and ends. */
async function claudeWakeupEvents() {
  const attachmentsDir = await mkdtemp(path.join(tmpdir(), 'platform-claude-wakeup-'))
  onTestFinished(() => rm(attachmentsDir, { force: true, recursive: true }))
  const queries: FakeClaudeQuery[] = []
  const adapter = new ClaudeProviderAdapter({
    attachmentsDir,
    auth: signedInClaudeAuth(),
    createQuery: (input) => {
      const query = new FakeClaudeQuery()
      if (!input.options.strictMcpConfig) queries.push(query)
      input.options.abortController?.signal.addEventListener('abort', () => query.finish(), {
        once: true,
      })
      return query as unknown as Query
    },
    resolveExecutable: resolveFakeClaudeExecutable,
  })
  onTestFinished(() => adapter.stopAll())
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => {
    events.push(event)
  })
  await adapter.startRuntime({
    cwd: '/fixture',
    interactionMode: DEFAULT_INTERACTION_MODE,
    modelSelection: {
      model: SYNTHETIC_OPUS,
      providerInstanceId: DEFAULT_CLAUDE_PROVIDER_SETTINGS.providerInstanceId,
    },
    providerInstanceId: DEFAULT_CLAUDE_PROVIDER_SETTINGS.providerInstanceId,
    runtimeEpoch: 'runtime-epoch',
    runtimeMode: 'full-access',
    sessionId: v.parse(sessionIdSchema, FAKE_CLAUDE_SESSION_ID),
  })
  const started = events.length
  const query = queries.at(-1)
  if (!query) throw new TypeError('No Claude query was created')
  const wakeup = 'd1407b55-97f0-434a-899d-397d1a308eb4'
  query.emit(commandLifecycle(wakeup, 'started'))
  query.emit(fakeClaudeInit())
  query.emit(assistantText('AWAKE'))
  query.emit(fakeClaudeSuccess())
  query.emit(commandLifecycle(wakeup, 'completed'))
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (events.some((event) => event.type === 'runtime.state.changed' && event.turnId)) break
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return events.slice(started)
}

test('a harness turn the log leaves out does not settle the requested turn it overlapped', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing worktree registration')
  await fixture.createSession(registration.result.worktreeId, FAKE_CLAUDE_SESSION_ID)
  await fixture.startTurn(FAKE_CLAUDE_SESSION_ID, 'turn-2')
  const queued = (await sessionFrom(fixture, FAKE_CLAUDE_SESSION_ID)).latestTurn
  if (!queued) throw new TypeError('Missing requested turn')
  await fixture.command({
    type: 'session.provider-start.claim',
    commandId: 'claim-turn-2',
    sessionId: FAKE_CLAUDE_SESSION_ID,
    turnId: 'turn-2',
    observedSequence: queued.providerStartSequence,
    generation: 1,
    runtimeEpoch: 'runtime-epoch',
    createdAt: '2026-09-26T12:00:00.000Z',
  })

  // The requested turn is claimed but not yet sent when the idle runtime runs a wakeup.
  const events = await claudeWakeupEvents()
  expect(events.some((event) => event.type === 'turn.completed')).toBe(true)
  let model = await fixture.engine.readModelSnapshot()
  const ingestion = new ProviderRuntimeIngestion(
    (command, source) => fixture.engine.dispatchProviderCommand(command, source),
    { getReadModel: () => model },
  )
  for (const event of events) {
    model = await fixture.engine.readModelSnapshot()
    await ingestion.ingest(event)
  }

  expect((await sessionFrom(fixture, FAKE_CLAUDE_SESSION_ID)).latestTurn).toMatchObject({
    providerStartState: 'claimed',
    state: 'running',
    turnId: 'turn-2',
  })
})
