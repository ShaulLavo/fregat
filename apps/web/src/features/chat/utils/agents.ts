import type { ChatAgent, OrchestrationSessionActivity, TurnId } from '@workspace/contracts'

import { chatAgentActivity } from '@/features/chat/utils/agent-activity'
import { formatChatElapsed } from '@/features/chat/utils/formatters'
import {
  chatWorkLogEntries,
  chatWorkLogEntryEquals,
  type ChatWorkLogEntry,
} from '@/features/chat/utils/work-log'

export type ChatAgentEntry = {
  agent: ChatAgent
  startedAt: string
  updatedAt: string
  description: string | null
  summary: string | null
  totalTokens: number | null
  activities: readonly ChatWorkLogEntry[]
}

export type ChatAgentGroup = {
  id: string
  turnId: TurnId | null
  createdAt: string
  agents: readonly ChatAgentEntry[]
}

type AgentAccumulator = Omit<ChatAgentEntry, 'activities'> & {
  tools: OrchestrationSessionActivity[]
}

type GroupAccumulator = Omit<ChatAgentGroup, 'agents'> & {
  agents: Map<string, AgentAccumulator>
}

type AgentSnapshot = Pick<
  ChatAgentEntry,
  'agent' | 'updatedAt' | 'description' | 'summary' | 'totalTokens'
>

export function chatAgentGroups(
  activities: readonly OrchestrationSessionActivity[],
): ChatAgentGroup[] {
  const groups = new Map<string, GroupAccumulator>()
  const owners = agentOwners(activities)
  for (const activity of activities) {
    const payload = chatAgentActivity(activity.payload)
    if (!payload) continue

    const turnId = activity.turnId ?? owners.get(payload.agent.threadId) ?? null
    const id = `agents:${activity.sessionId}:${turnId ?? payload.agent.threadId}`
    const group = groups.get(id) ?? {
      id,
      turnId,
      createdAt: activity.createdAt,
      agents: new Map(),
    }
    updateAgent(group, { ...activity, turnId }, payload)
    groups.set(id, group)
  }

  return Array.from(groups.values(), (group) => ({
    ...group,
    agents: Array.from(group.agents.values(), ({ tools, ...agent }) => ({
      ...agent,
      activities: chatWorkLogEntries({ activities: tools }),
    })),
  }))
}

function agentOwners(activities: readonly OrchestrationSessionActivity[]) {
  const owners = new Map<string, TurnId>()
  for (const activity of activities) {
    if (!activity.turnId) continue
    const payload = chatAgentActivity(activity.payload)
    if (!payload || owners.has(payload.agent.threadId)) continue
    owners.set(payload.agent.threadId, activity.turnId)
  }
  return owners
}

function updateAgent(
  group: GroupAccumulator,
  activity: OrchestrationSessionActivity,
  payload: NonNullable<ReturnType<typeof chatAgentActivity>>,
) {
  const previous = group.agents.get(payload.agent.threadId)
  const incoming: AgentSnapshot = {
    agent: payload.agent,
    updatedAt: payload.agent.updatedAt ?? activity.createdAt,
    description: payload.description ?? null,
    summary: payload.summary ?? null,
    totalTokens: payload.usage?.totalTokens ?? null,
  }
  const incomingIsLatest = !previous || isNewerAgentSnapshot(incoming, previous)
  const current = incomingIsLatest ? incoming : previous!
  const fallback = incomingIsLatest ? previous : incoming
  const next: AgentAccumulator = {
    agent: { ...fallback?.agent, ...current.agent },
    startedAt: previous?.startedAt ?? activity.createdAt,
    updatedAt: current.updatedAt,
    description: current.description ?? fallback?.description ?? null,
    summary: current.summary ?? fallback?.summary ?? null,
    totalTokens: current.totalTokens ?? fallback?.totalTokens ?? null,
    tools: previous?.tools ?? [],
  }
  if (payload.tool) next.tools.push(agentToolActivity(activity, payload.tool))
  if (!activity.kind.startsWith('task.')) {
    const { agent: _agent, ...detail } = payload
    next.tools.push({ ...activity, payload: detail })
  }
  group.agents.set(payload.agent.threadId, next)
}

function isNewerAgentSnapshot(incoming: AgentSnapshot, previous: AgentSnapshot) {
  const order = incoming.updatedAt.localeCompare(previous.updatedAt)
  if (order !== 0) return order > 0
  const nextRevision = incoming.agent.revision
  const previousRevision = previous.agent.revision
  if (nextRevision !== undefined && previousRevision !== undefined)
    return nextRevision >= previousRevision
  if (previousRevision !== undefined) return false
  if (nextRevision !== undefined) return true
  return true
}

function agentToolActivity(
  activity: OrchestrationSessionActivity,
  tool: NonNullable<NonNullable<ReturnType<typeof chatAgentActivity>>['tool']>,
): OrchestrationSessionActivity {
  return {
    ...activity,
    kind: tool.status === 'inProgress' ? 'tool.started' : 'tool.completed',
    tone: 'tool',
    summary: tool.title ?? tool.detail ?? tool.itemType,
    payload: {
      itemType: tool.itemType,
      toolCallId: tool.itemId,
      status: tool.status,
      title: tool.title,
      detail: tool.detail,
      data: tool.data,
    },
  }
}

export function chatAgentIsWorking(agent: ChatAgent) {
  return agent.status === 'running' || agent.status === 'waiting'
}

export function chatAgentName(agent: ChatAgent) {
  return agent.nickname ?? agent.path ?? agent.role ?? `Agent ${agent.threadId.slice(0, 8)}`
}

export function chatAgentStatus(agent: ChatAgent) {
  if (agent.status === 'running') return 'Working'
  if (agent.status === 'waiting') return 'Waiting'
  if (agent.status === 'idle') return 'Idle · resumable'
  if (agent.status === 'interrupted') return 'Stopped'
  if (agent.status === 'failed') return 'Failed'
  return 'Closed'
}

export function chatAgentGroupLabel(group: ChatAgentGroup) {
  const count = group.agents.length
  const workingCount = group.agents.filter((entry) => chatAgentIsWorking(entry.agent)).length
  if (workingCount === count) return `${count} ${count === 1 ? 'agent' : 'agents'} working`
  if (workingCount > 0) return `${workingCount} of ${count} agents working`
  const failedCount = group.agents.filter((entry) => entry.agent.status === 'failed').length
  if (failedCount > 0) return `${count} ${count === 1 ? 'agent' : 'agents'} · ${failedCount} failed`
  return `${count} ${count === 1 ? 'agent' : 'agents'} finished`
}

export function chatAgentElapsed(entry: ChatAgentEntry) {
  return formatChatElapsed(entry.startedAt, entry.updatedAt)
}

export function chatAgentToolCount(entry: ChatAgentEntry) {
  return entry.activities.filter((activity) => activity.sourceKind.startsWith('tool.')).length
}

export function chatAgentGroupsEqual(left: ChatAgentGroup, right: ChatAgentGroup) {
  if (left.turnId !== right.turnId || left.agents.length !== right.agents.length) return false
  return left.agents.every((entry, index) => agentEntriesEqual(entry, right.agents[index]))
}

function agentEntriesEqual(left: ChatAgentEntry, right: ChatAgentEntry | undefined) {
  if (!right) return false
  if (left.startedAt !== right.startedAt || left.updatedAt !== right.updatedAt) return false
  if (left.description !== right.description || left.summary !== right.summary) return false
  if (left.totalTokens !== right.totalTokens) return false
  if (left.activities.length !== right.activities.length) return false
  const fields = [
    'threadId',
    'parentThreadId',
    'path',
    'nickname',
    'role',
    'model',
    'effort',
    'status',
  ] as const
  if (!fields.every((field) => left.agent[field] === right.agent[field])) return false
  return left.activities.every((entry, index) =>
    chatWorkLogEntryEquals(entry, right.activities[index]!),
  )
}
