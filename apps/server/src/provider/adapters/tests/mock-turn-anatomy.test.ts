import { expect, test } from 'vitest'
import * as v from 'valibot'
import { providerInstanceIdSchema, sessionIdSchema, turnIdSchema } from '@workspace/contracts'

import { MockProviderAdapter } from '../mock'
import type { ProviderRuntimeEvent, ProviderTurnInput } from '../../types'

const providerInstanceId = v.parse(providerInstanceIdSchema, 'mock-anatomy')

function turnInput(): ProviderTurnInput {
  return {
    attachments: [],
    cwd: '/work/tmp',
    interactionMode: 'default',
    messageText: 'Fix the failing test',
    modelSelection: { model: 'gpt-5.5', providerInstanceId },
    providerInstanceId,
    runtimeEpoch: 'epoch-anatomy',
    runtimeMode: 'full-access',
    sessionId: v.parse(sessionIdSchema, 'b1f0c9d2-5c55-4f4d-9f0e-2f7d1f1e5a01'),
    turnId: v.parse(turnIdSchema, 'turn-anatomy'),
  }
}

async function scriptedEvents(adapter: MockProviderAdapter) {
  const events: ProviderRuntimeEvent[] = []
  const done = Promise.withResolvers<void>()
  adapter.subscribeEvents((event) => {
    if (event.type === 'runtime.started' || event.type === 'conversation.started') return
    events.push(event)
    if (event.type === 'turn.completed') done.resolve()
  })
  await adapter.sendTurn(turnInput())
  await done.promise

  return events
}

test('the scripted turn streams reasoning, a plan that drops a step, four calls and two agents', async () => {
  const events = await scriptedEvents(
    new MockProviderAdapter({ script: 'turn-anatomy', stepDelayMs: 0 }),
  )
  const kinds = events.map((event) => event.type)
  const completed = events.filter((event) => event.type === 'item.completed')
  const plans = events.filter((event) => event.type === 'turn.plan.updated')
  const agents = events.flatMap((event) =>
    'agent' in event && event.agent ? [event.agent.threadId] : [],
  )

  expect(kinds[0]).toBe('turn.started')
  expect(kinds.filter((kind) => kind === 'content.delta').length).toBeGreaterThan(1)
  expect(completed.map((event) => event.payload.status)).toEqual([
    'completed',
    'completed',
    'failed',
    'completed',
  ])
  expect(plans.map((event) => event.payload.plan.length)).toEqual([4, 3])
  expect(new Set(agents)).toEqual(new Set(['mock-reviewer', 'mock-checker']))
  expect(kinds.slice(-3)).toEqual(['assistant.complete', 'usage.totals', 'turn.completed'])
})

test('a scripted mock offers the effort levels, and the plain mock keeps its one-line answer', async () => {
  const scripted = await new MockProviderAdapter({ script: 'turn-anatomy' }).snapshot()
  const plain = new MockProviderAdapter()
  const events = await scriptedEvents(plain)

  expect(scripted.models[0]?.capabilities?.optionDescriptors?.[0]).toMatchObject({
    id: 'effort',
    promptInjectedValues: ['ultrathink'],
  })
  expect((await plain.snapshot()).models[0]?.capabilities).toBeNull()
  expect(events.map((event) => event.type)).toEqual([
    'turn.started',
    'assistant.delta',
    'assistant.complete',
    'usage.totals',
    'turn.completed',
  ])
})
