import type { ChatAgent, ChatAgentTool } from '@workspace/contracts'
import { asRecord, stringField } from './records'
import { canonicalItemType } from './codex-item-type'

export function notificationThreadId(params: unknown) {
  const record = asRecord(params)
  return stringField(record, 'threadId') ?? stringField(asRecord(record.thread), 'id') ?? undefined
}

export function notificationTurnId(params: unknown) {
  const record = asRecord(params)
  return stringField(record, 'turnId') ?? stringField(asRecord(record.turn), 'id') ?? undefined
}

export function childRegistration(
  method: string,
  params: unknown,
): Omit<ChatAgent, 'status'> | undefined {
  const record = asRecord(params)
  const item = asRecord(record.item)
  if (
    (method === 'item/started' || method === 'item/completed') &&
    item.type === 'subAgentActivity'
  ) {
    const threadId = stringField(item, 'agentThreadId')
    if (!threadId || item.agentPath === '/root' || item.agentPath === '/') return
    return { threadId, path: stringField(item, 'agentPath') ?? undefined }
  }
  if (method !== 'thread/started') return
  const thread = asRecord(record.thread)
  const source = asRecord(asRecord(thread.source).subAgent)
  if (!source.thread_spawn) return
  const spawn = asRecord(source.thread_spawn)
  const threadId = stringField(thread, 'id')
  if (!threadId) return
  return {
    threadId,
    path: stringField(spawn, 'agent_path') ?? undefined,
    parentThreadId:
      stringField(spawn, 'parent_thread_id') ?? stringField(thread, 'parentThreadId') ?? undefined,
    nickname:
      stringField(spawn, 'agent_nickname') ?? stringField(thread, 'agentNickname') ?? undefined,
    role: stringField(spawn, 'agent_role') ?? stringField(thread, 'agentRole') ?? undefined,
  }
}

export function childName(agent: ChatAgent) {
  return agent.nickname ?? agent.path?.split('/').findLast(Boolean) ?? agent.role ?? 'Agent'
}

export function childStatus(params: unknown): ChatAgent['status'] | undefined {
  const status = asRecord(asRecord(params).status)
  if (status.type === 'systemError') return 'failed'
  if (status.type === 'idle') return 'idle'
  if (status.type !== 'active') return
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags : []
  return flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')
    ? 'waiting'
    : 'running'
}

export function childTool(
  item: Record<string, unknown>,
  method: string,
): ChatAgentTool | undefined {
  const itemId = stringField(item, 'id')
  const itemType = stringField(item, 'type')
  if (!itemId || !itemType) return
  if (['reasoning', 'agentMessage', 'userMessage', 'subAgentActivity'].includes(itemType)) return
  let status: ChatAgentTool['status'] = method === 'item/started' ? 'inProgress' : 'completed'
  if (item.status === 'failed' || item.status === 'declined') status = item.status
  return {
    itemId,
    itemType: canonicalItemType(itemType),
    status,
    title:
      stringField(item, 'command') ??
      stringField(item, 'title') ??
      stringField(item, 'tool') ??
      itemType,
    detail: childToolDetail(item),
    data: item,
  }
}

function childToolDetail(item: Record<string, unknown>) {
  if (typeof item.aggregatedOutput === 'string') return item.aggregatedOutput
  if (typeof item.text === 'string') return item.text
}

export const childNotificationMethods: ReadonlySet<string> = new Set([
  'thread/started',
  'turn/started',
  'turn/completed',
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'thread/settings/updated',
  'model/rerouted',
  'item/started',
  'item/completed',
  'thread/closed',
  'error',
  'item/agentMessage/delta',
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/commandExecution/outputDelta',
  'command/exec/outputDelta',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/plan/delta',
  'turn/plan/updated',
  'turn/diff/updated',
  'thread/name/updated',
  'rawResponseItem/completed',
  'thread/archived',
  'thread/unarchived',
  'thread/compacted',
  'item/mcpToolCall/progress',
])

export function completedChildStatus(status: unknown): ChatAgent['status'] {
  if (status === 'failed') return 'failed'
  if (status === 'interrupted') return 'interrupted'
  return 'idle'
}

export function definedChildIdentity(identity: Omit<ChatAgent, 'status'>): Partial<ChatAgent> {
  return Object.fromEntries(Object.entries(identity).filter(([, value]) => value !== undefined))
}

export function childTokenUsage(params: unknown) {
  const total = asRecord(asRecord(asRecord(params).tokenUsage).total)
  if (!validTokenCount(total.totalTokens)) return
  const usage: Record<string, number> = { totalTokens: total.totalTokens }
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens']) {
    const value = total[key]
    if (!validTokenCount(value)) continue
    usage[key] = value
  }
  return usage
}

function validTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export const CODEX_CHILD_PENDING_LIMITS = {
  threads: 128,
  events: 512,
  bytes: 2 * 1024 * 1024,
} as const
