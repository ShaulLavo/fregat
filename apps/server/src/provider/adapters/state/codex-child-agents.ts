import type { ChatAgent, ChatAgentTool, TurnId } from '@workspace/contracts'
import type { ProviderRuntimeEventPayload } from '../../types'
import { asRecord, stringField } from '../utils/records'
import {
  childName,
  childNotificationMethods,
  childRegistration,
  childStatus,
  childTool,
  childTokenUsage,
  completedChildStatus,
  definedChildIdentity,
  notificationThreadId,
  notificationTurnId,
} from '../utils/codex-child-notifications'

type TaskEvent = Extract<ProviderRuntimeEventPayload, { type: 'task.started' | 'task.progress' }>
type Child = {
  agent: ChatAgent
  turnId: TurnId | undefined
  tools: Map<string, ChatAgentTool>
  summary?: string
  usage?: unknown
}
type Notification = { method: string; params: unknown }
export type CodexChildAgentEvent = (
  | Pick<Extract<TaskEvent, { type: 'task.started' }>, 'type' | 'payload'>
  | Pick<Extract<TaskEvent, { type: 'task.progress' }>, 'type' | 'payload'>
) & { agent: ChatAgent; turnId?: TurnId; method: string; params: unknown; itemId?: string }

type Options = {
  rootThreadId: string
  canonicalTurn: (providerTurnId: string | undefined) => TurnId | undefined
  currentTurn: () => TurnId | undefined
  emit: (event: CodexChildAgentEvent) => void
}

export class CodexChildAgents {
  private readonly children = new Map<string, Child>()
  private readonly pending = new Map<string, Notification[]>()
  private readonly liveTurns = new Map<string, string>()

  private readonly options: Options

  constructor(options: Options) {
    this.options = options
  }

  owner(params: unknown) {
    const threadId = notificationThreadId(params)
    const child = threadId ? this.children.get(threadId) : undefined
    if (child) return { agent: { ...child.agent }, turnId: child.turnId }
    if (threadId && threadId !== this.options.rootThreadId)
      return { agent: { threadId, status: 'waiting' } satisfies ChatAgent, turnId: undefined }
    return { turnId: this.options.canonicalTurn(notificationTurnId(params)) }
  }

  isRegistered(threadId: string) {
    return this.children.has(threadId)
  }

  activeTurns() {
    return Array.from(this.liveTurns, ([threadId, turnId]) => ({ threadId, turnId }))
  }

  handle(method: string, params: unknown) {
    const registration = childRegistration(method, params)
    if (registration && registration.threadId !== this.options.rootThreadId) {
      this.register(registration, method, params)
      return true
    }
    this.registerReceivers(method, params)
    const threadId = notificationThreadId(params)
    if (!threadId || threadId === this.options.rootThreadId) return false
    if (!childNotificationMethods.has(method)) return false
    this.trackTurn(threadId, method, params)
    const child = this.children.get(threadId)
    if (child) {
      this.update(child, method, params)
      return true
    }
    const pending = this.pending.get(threadId) ?? []
    pending.push({ method, params })
    this.pending.set(threadId, pending)
    return true
  }

  private register(identity: Omit<ChatAgent, 'status'>, method: string, params: unknown) {
    // A later registration enriches identity without moving an old child to the current turn.
    const existing = this.children.get(identity.threadId)
    if (existing) {
      existing.agent = { ...existing.agent, ...definedChildIdentity(identity) }
      this.applyActivityStatus(existing, params)
      this.emit(existing, method, params)
      return
    }
    const parentThreadId = identity.parentThreadId ?? notificationThreadId(params)
    const parent = parentThreadId ? this.children.get(parentThreadId) : undefined
    const providerTurnId = notificationTurnId(params)
    const turnId = parent ? parent.turnId : this.registrationTurn(providerTurnId)
    const child: Child = {
      agent: {
        ...identity,
        parentThreadId: parentThreadId === identity.threadId ? undefined : parentThreadId,
        status: 'running',
      },
      turnId,
      tools: new Map(),
    }
    this.applyActivityStatus(child, params)
    child.agent.updatedAt = new Date().toISOString()
    child.agent.revision = 1
    this.children.set(identity.threadId, child)
    this.options.emit({
      agent: { ...child.agent },
      turnId,
      method,
      params,
      type: 'task.started',
      payload: {
        taskId: identity.threadId,
        taskType: 'agent',
        description: childName(child.agent),
      },
    })
    const pending = this.pending.get(identity.threadId) ?? []
    this.pending.delete(identity.threadId)
    for (const notification of pending) this.update(child, notification.method, notification.params)
  }

  private registrationTurn(providerTurnId: string | undefined) {
    if (providerTurnId) return this.options.canonicalTurn(providerTurnId)
    return this.options.currentTurn()
  }

  private applyActivityStatus(child: Child, params: unknown) {
    const kind = asRecord(asRecord(params).item).kind
    if (kind === 'interrupted') child.agent.status = 'interrupted'
    if (
      kind === 'completed' &&
      child.agent.status !== 'failed' &&
      child.agent.status !== 'interrupted'
    )
      child.agent.status = 'idle'
    if (kind === 'started') child.agent.status = 'running'
  }

  private registerReceivers(method: string, params: unknown) {
    if (method !== 'item/started' && method !== 'item/completed') return
    const item = asRecord(asRecord(params).item)
    if (item.type !== 'collabAgentToolCall' || !Array.isArray(item.receiverThreadIds)) return
    for (const threadId of item.receiverThreadIds) {
      if (
        typeof threadId !== 'string' ||
        threadId === this.options.rootThreadId ||
        this.children.has(threadId)
      )
        continue
      this.register({ threadId }, method, params)
    }
  }

  private trackTurn(threadId: string, method: string, params: unknown) {
    const turnId = notificationTurnId(params)
    if (method === 'turn/started' && turnId) this.liveTurns.set(threadId, turnId)
    if (method === 'turn/completed' || method === 'thread/closed') this.liveTurns.delete(threadId)
    if (method === 'error' && asRecord(params).willRetry !== true) this.liveTurns.delete(threadId)
  }

  private update(child: Child, method: string, params: unknown) {
    const record = asRecord(params)
    switch (method) {
      case 'turn/started':
        child.agent.status = 'running'
        child.summary = undefined
        break
      case 'turn/completed':
        child.agent.status = completedChildStatus(asRecord(record.turn).status)
        break
      case 'thread/status/changed':
        child.agent.status = childStatus(params) ?? child.agent.status
        break
      case 'thread/closed':
        child.agent.status = 'closed'
        break
      case 'error':
        child.summary = stringField(asRecord(record.error), 'message') ?? 'Agent error'
        if (record.willRetry !== true) child.agent.status = 'failed'
        break
      case 'thread/tokenUsage/updated':
        child.usage = childTokenUsage(params) ?? child.usage
        break
      case 'thread/settings/updated':
      case 'model/rerouted':
        this.updateMetadata(child, method, record)
        break
      case 'item/started':
      case 'item/completed':
        this.updateItem(child, method, params)
        return
      case 'item/commandExecution/outputDelta':
      case 'command/exec/outputDelta':
      case 'item/fileChange/outputDelta':
        this.updateOutput(child, method, params)
        return
      default:
        return
    }
    this.emit(child, method, params)
  }

  private updateMetadata(child: Child, method: string, record: Record<string, unknown>) {
    const settings = asRecord(record.threadSettings)
    const model =
      method === 'model/rerouted' ? stringField(record, 'toModel') : stringField(settings, 'model')
    if (model) child.agent.model = model
    const effort = stringField(settings, 'effort')
    if (effort) child.agent.effort = effort
  }

  private updateItem(child: Child, method: string, params: unknown) {
    const item = asRecord(asRecord(params).item)
    const tool = childTool(item, method)
    if (tool) {
      child.tools.set(tool.itemId, tool)
      child.summary = tool.title
      this.emit(child, method, params, tool)
      return
    }
    if (item.type !== 'agentMessage' || method !== 'item/completed') return
    child.summary = stringField(item, 'text') ?? child.summary
    this.emit(child, method, params)
  }

  private updateOutput(child: Child, method: string, params: unknown) {
    const record = asRecord(params)
    const itemId = stringField(record, 'itemId')
    const tool = itemId ? child.tools.get(itemId) : undefined
    if (!tool) return
    tool.detail = `${tool.detail ?? ''}${stringField(record, 'delta') ?? ''}`
    this.emit(child, method, params, tool)
  }

  private emit(child: Child, method: string, params: unknown, tool?: ChatAgentTool) {
    child.agent.revision = (child.agent.revision ?? 0) + 1
    child.agent.updatedAt = new Date().toISOString()
    this.options.emit({
      agent: { ...child.agent },
      turnId: child.turnId,
      method,
      params,
      itemId: tool?.itemId,
      type: 'task.progress',
      payload: {
        taskId: child.agent.threadId,
        description: childName(child.agent),
        summary: child.summary,
        usage: child.usage,
        ...(tool ? { tool: { ...tool }, lastToolName: tool.title } : {}),
      },
    })
  }
}
