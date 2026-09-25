import type { ChatAgent, ProviderModel } from '@workspace/contracts'

import type { ProviderRuntimeEvent, ProviderTurnInput } from '../../types'

/** One scripted step: how long after the previous one it lands, and what it publishes. */
export type MockScriptStep = { readonly delayMs: number; readonly event: ProviderRuntimeEvent }

export type MockTurnScript = 'turn-anatomy'

// Paragraphs, so a paragraph-paced delivery still streams them one by one.
const REASONING = [
  'The failing test points at the config parser.\n\n',
  'I want to read how frames are matched before I touch anything.\n\n',
  'Then I run the suite once to see the real trace.',
]

const FAILING_TEST_OUTPUT = `bun test v1.4.0

apps/web/src/features/chat/utils/tests/stack-frames.test.ts:
error: expect(received).toEqual(expected)
      at <anonymous> (apps/web/src/features/chat/utils/tests/stack-frames.test.ts:42:7)
      at chatWorkLogEntries (apps/web/src/features/chat/utils/work-log.ts:30:3)
      at processTicksAndRejections (node:internal/process/task_queues:105:5)

 0 pass
 1 fail`

const REVIEWER: ChatAgent = { nickname: 'Reviewer', status: 'running', threadId: 'mock-reviewer' }
const CHECKER: ChatAgent = {
  nickname: 'Checker',
  parentThreadId: 'mock-reviewer',
  status: 'running',
  threadId: 'mock-checker',
}

/** The one model a scripted mock offers, with the effort levels the sparkle reads. */
export function mockTurnAnatomyModel(): ProviderModel {
  return {
    capabilities: {
      optionDescriptors: [
        {
          currentValue: 'high',
          id: 'effort',
          label: 'Reasoning',
          options: [
            { id: 'low', label: 'Low' },
            { id: 'high', label: 'High', isDefault: true },
            { id: 'xhigh', label: 'Extra high' },
            { id: 'max', label: 'Max' },
            { id: 'ultrathink', label: 'Ultrathink' },
          ],
          promptInjectedValues: ['ultrathink'],
          type: 'select',
        },
      ],
    },
    isCustom: false,
    name: 'GPT-5.5',
    shortName: 'GPT-5.5',
    slug: 'gpt-5.5',
  }
}

/**
 * A whole turn in the shape real providers send it: streamed reasoning, a plan that
 * later drops a step, four tool calls (one failing with a Bun trace, one with JSON
 * input), a subagent with a child of its own, then the answer.
 */
export function mockTurnAnatomySteps(
  input: ProviderTurnInput,
  stepDelayMs: number,
): MockScriptStep[] {
  const base = (id: string): ScriptBase => ({
    // Stamped again at publish: the timeline measures real time between steps.
    createdAt: '',
    eventId: `mock-anatomy:${input.turnId}:${id}`,
    runtimeEpoch: input.runtimeEpoch,
    sessionId: input.sessionId,
    turnId: input.turnId,
  })
  const step = (delayMs: number, event: ProviderRuntimeEvent): MockScriptStep => ({
    delayMs,
    event,
  })
  const reasoning = REASONING.map((delta, index) =>
    step(stepDelayMs, {
      ...base(`reasoning-${index}`),
      itemId: 'reasoning',
      payload: { delta, streamKind: 'reasoning_text' },
      type: 'content.delta',
    }),
  )

  return [
    ...reasoning,
    step(stepDelayMs, planEvent(base('plan-1'), 'first')),
    ...toolSteps(base, stepDelayMs, 'search', {
      itemType: 'command_execution',
      data: {
        command: 'rg parseConfig apps/web/src',
        aggregatedOutput: 'src/config.ts:12',
        exitCode: 0,
      },
    }),
    ...toolSteps(base, stepDelayMs, 'issue', {
      itemType: 'mcp_tool_call',
      title: 'linear · get_issue',
      data: {
        arguments: { id: 'ENG-12', fields: ['title', 'state'] },
        output: 'ENG-12 · In progress',
      },
    }),
    ...toolSteps(base, stepDelayMs, 'test', {
      itemType: 'command_execution',
      status: 'failed',
      data: {
        command: 'bun test apps/web/src/features/chat/utils/tests/stack-frames.test.ts',
        aggregatedOutput: FAILING_TEST_OUTPUT,
        exitCode: 1,
      },
    }),
    step(stepDelayMs, agentEvent(base('reviewer-start'), REVIEWER, 'task.started')),
    step(stepDelayMs, agentEvent(base('checker-start'), CHECKER, 'task.started')),
    step(
      stepDelayMs,
      agentEvent(base('checker-done'), { ...CHECKER, status: 'idle' }, 'task.completed'),
    ),
    step(
      stepDelayMs,
      agentEvent(base('reviewer-done'), { ...REVIEWER, status: 'idle' }, 'task.completed'),
    ),
    step(stepDelayMs, planEvent(base('plan-2'), 'second')),
    ...toolSteps(base, stepDelayMs, 'edit', {
      itemType: 'file_change',
      data: {
        changes: [{ kind: 'update', path: 'apps/web/src/features/chat/utils/stack-frames.ts' }],
      },
    }),
    step(stepDelayMs, {
      ...base('answer'),
      delta: 'Fixed the frame match; the suite passes again.',
      messageId: `assistant:${input.turnId}`,
      type: 'assistant.delta',
    }),
  ]
}

type ToolPayload = {
  data: Record<string, unknown>
  itemType: string
  status?: 'completed' | 'failed'
  title?: string
}

function toolSteps(
  base: (id: string) => ScriptBase,
  stepDelayMs: number,
  id: string,
  tool: ToolPayload,
): MockScriptStep[] {
  const payload = { data: tool.data, itemType: tool.itemType, title: tool.title }
  return [
    {
      delayMs: stepDelayMs,
      event: {
        ...base(`${id}-start`),
        itemId: id,
        payload: { ...payload, status: 'inProgress' },
        type: 'item.started',
      },
    },
    {
      delayMs: stepDelayMs,
      event: {
        ...base(`${id}-done`),
        itemId: id,
        payload: { ...payload, status: tool.status ?? 'completed' },
        type: 'item.completed',
      },
    },
  ]
}

type ScriptBase = {
  createdAt: string
  eventId: string
  runtimeEpoch: string
  sessionId: ProviderTurnInput['sessionId']
  turnId: ProviderTurnInput['turnId']
}

function planEvent(base: ScriptBase, snapshot: 'first' | 'second'): ProviderRuntimeEvent {
  const plan =
    snapshot === 'first'
      ? [
          { status: 'inProgress' as const, step: 'Find the parser' },
          { status: 'pending' as const, step: 'Run the failing test' },
          { status: 'pending' as const, step: 'Write a migration' },
          { status: 'pending' as const, step: 'Fix the frame match' },
        ]
      : [
          { status: 'completed' as const, step: 'Find the parser' },
          { status: 'completed' as const, step: 'Run the failing test' },
          { status: 'inProgress' as const, step: 'Fix the frame match' },
        ]
  return { ...base, payload: { explanation: null, plan }, type: 'turn.plan.updated' }
}

function agentEvent(
  base: ScriptBase,
  agent: ChatAgent,
  type: 'task.started' | 'task.completed',
): ProviderRuntimeEvent {
  const taskId = `${agent.threadId}-task`
  if (type === 'task.started') {
    return {
      ...base,
      agent,
      payload: { description: `${agent.nickname} checks the trace`, taskId },
      type,
    }
  }

  return {
    ...base,
    agent,
    payload: { status: 'completed', summary: 'No other callers', taskId },
    type,
  }
}
