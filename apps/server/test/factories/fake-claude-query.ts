import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeAuthRunner } from '../../src/provider/adapters/utils/claude-auth'
import { claudeModelRows } from './claude-models'

/**
 * The `claude` CLI, faked: a hand-driven `AsyncIterable<SDKMessage>` the adapter's
 * `createQuery` returns, plus the account probe. Everything behind it is real app code.
 */

export const FAKE_CLAUDE_SESSION_ID = 'ee84050b-1b17-5fe8-9f71-0983f1fceccc'
const SYSTEM_UUID = '44444444-4444-4444-8444-444444444444'

export function signedInClaudeAuth() {
  return new ClaudeAuthRunner({
    spawn: () => ({
      exited: Promise.resolve({ exitCode: 0, stderr: '', stdout: '{"loggedIn":true}' }),
      kill: () => undefined,
    }),
  })
}

/**
 * The real `initializationResult()` answers in ~0.5s with NO prompt pushed, and
 * its payload carries NO `session_id` — which is the whole reason the adapter
 * has to mint the id itself. Keep this faithful to that shape.
 */
const INITIALIZE_RESPONSE = {
  account: { email: 'dev@example.com', subscriptionType: 'max' },
  agents: [
    { description: ' Reviews a diff ', model: 'sonnet', name: 'reviewer' },
    { description: 'Unnamed', name: ' ' },
  ],
  available_output_styles: ['default'],
  commands: [],
  models: claudeModelRows(),
  output_style: 'default',
}

/** `get_usage` as the CLI answers it for a Max account: 0–100 percentages, ISO resets. */
const GET_USAGE_RESPONSE = {
  behaviors: null,
  rate_limits: {
    five_hour: { resets_at: '2026-09-24T12:00:00Z', utilization: 54 },
    model_scoped: [{ display_name: 'Fable', resets_at: null, utilization: 73 }],
    seven_day: { resets_at: null, utilization: 18.4 },
  },
  rate_limits_available: true,
  session: {
    model_usage: {},
    total_api_duration_ms: 0,
    total_cost_usd: 0,
    total_duration_ms: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  },
  subscription_type: 'max',
}

type FakeWaiter = {
  reject: (reason: unknown) => void
  resolve: (value: IteratorResult<SDKMessage>) => void
}

/**
 * Ported from `references/t3code/.../ClaudeAdapter.test.ts` with the Effect
 * wrapper dropped: a hand-driven `AsyncIterable<SDKMessage>` with a queue, a
 * waiter list, and call recorders for the control requests the adapter uses.
 */
export class FakeClaudeQuery implements AsyncIterable<SDKMessage> {
  readonly setModelCalls: Array<string | undefined> = []
  readonly stoppedTasks: string[] = []
  readonly getContextUsage = async () => ({
    categories: [
      { color: 'a', kind: 'used' as const, name: 'System tools', tokens: 9_000 },
      { color: 'b', kind: 'used' as const, name: 'Messages', tokens: 3_000 },
      { color: 'c', kind: 'deferred' as const, name: 'MCP tools (deferred)', tokens: 21_000 },
      { color: 'd', kind: 'buffer' as const, name: 'Autocompact buffer', tokens: 13_000 },
      { color: 'e', kind: 'free' as const, name: 'Free space', tokens: 175_000 },
    ],
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    totalTokens: 12_000,
  })
  readonly reconnected: string[] = []
  readonly mcpServerStatus = async () => [
    { name: 'linear', status: 'connected' as const },
    { error: 'spawn ENOENT', name: 'broken', status: 'failed' as const },
  ]
  readonly reconnectMcpServer = async (name: string) => {
    this.reconnected.push(name)
  }
  readonly stopTask = async (taskId: string) => {
    this.stoppedTasks.push(taskId)
  }
  acknowledgeClose = true
  closeCalls = 0
  interruptCalls = 0
  private readonly queue: SDKMessage[] = []
  private readonly waiters: FakeWaiter[] = []
  private done = false
  private failure: unknown = undefined

  emit(message: SDKMessage) {
    if (this.done) return

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ done: false, value: message })
      return
    }

    this.queue.push(message)
  }

  fail(cause: unknown) {
    if (this.done) return

    this.done = true
    this.failure = cause
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(cause)
    }
  }

  finish() {
    if (this.done) return

    this.done = true
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined })
    }
  }

  readonly interrupt = async () => {
    this.interruptCalls += 1
    return undefined
  }

  readonly initializationResult = async () => INITIALIZE_RESPONSE

  readonly usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () =>
    GET_USAGE_RESPONSE

  readonly setModel = async (model?: string) => {
    this.setModelCalls.push(model)
  }

  readonly close = () => {
    this.closeCalls += 1
    if (this.acknowledgeClose) this.finish()
  };

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return { next: () => this.next() }
  }

  private next(): Promise<IteratorResult<SDKMessage>> {
    const value = this.queue.shift()
    if (value) return Promise.resolve({ done: false, value })

    if (this.failure !== undefined) {
      const failure = this.failure
      this.failure = undefined
      return Promise.reject(failure)
    }
    if (this.done) return Promise.resolve({ done: true, value: undefined })

    return new Promise<IteratorResult<SDKMessage>>((resolve, reject) => {
      this.waiters.push({ reject, resolve })
    })
  }
}

/** Not in the SDK's message union; the CLI sends it for every uuid-stamped prompt and each wakeup. */
export function commandLifecycle(commandUuid: string, state: string): SDKMessage {
  return {
    command_uuid: commandUuid,
    session_id: FAKE_CLAUDE_SESSION_ID,
    state,
    type: 'command_lifecycle',
    uuid: SYSTEM_UUID,
  } as unknown as SDKMessage
}

export function assistantText(text: string): SDKMessage {
  return {
    message: { content: [{ text, type: 'text' }], role: 'assistant' },
    parent_tool_use_id: null,
    session_id: FAKE_CLAUDE_SESSION_ID,
    type: 'assistant',
    uuid: '55555555-5555-4555-8555-555555555555',
  } as unknown as SDKMessage
}

export function fakeClaudeInit(): SDKMessage {
  return {
    apiKeySource: 'oauth',
    claude_code_version: '9.9.9',
    cwd: '/fixture',
    mcp_servers: [],
    model: 'claude-opus-5',
    output_style: 'default',
    permissionMode: 'bypassPermissions',
    plugins: [],
    session_id: FAKE_CLAUDE_SESSION_ID,
    skills: [],
    slash_commands: [],
    subtype: 'init',
    tools: [],
    type: 'system',
    uuid: '11111111-1111-4111-8111-111111111111',
  } as unknown as SDKMessage
}

export function fakeClaudeSuccess(): SDKMessage {
  return {
    duration_api_ms: 5,
    duration_ms: 10,
    is_error: false,
    modelUsage: {},
    num_turns: 1,
    permission_denials: [],
    result: 'done',
    session_id: FAKE_CLAUDE_SESSION_ID,
    stop_reason: null,
    subtype: 'success',
    total_cost_usd: 0,
    type: 'result',
    usage: { input_tokens: 5, output_tokens: 7 },
    uuid: '33333333-3333-4333-8333-333333333333',
  } as unknown as SDKMessage
}
