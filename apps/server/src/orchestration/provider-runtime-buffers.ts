import { purgeExpiredEntries, readFreshEntry, trimEntriesToCapacity } from '../utils/cache-entries'
import { messageIdSchema, type MessageId, type SessionId, type TurnId } from '@workspace/contracts'
import * as v from 'valibot'
import {
  splitBufferedAssistantText,
  MIN_ASSISTANT_DELIVERY_INTERVAL_MS,
  type ResponseStreamingMode,
} from './response-delivery'

const ASSISTANT_MESSAGE_IDS_BY_TURN_CAPACITY = 10_000
const BUFFERED_ASSISTANT_TEXT_BY_MESSAGE_ID_CAPACITY = 20_000
const BUFFERED_PROPOSED_PLAN_BY_ID_CAPACITY = 10_000
export const PROVIDER_RUNTIME_BUFFER_TTL_MS = 120 * 60 * 1000
export const MAX_BUFFERED_ASSISTANT_CHARS = 24_000

type CacheEntry<Value> = {
  expiresAt: number
  value: Value
}

type AssistantSegmentState = {
  activeMessageId: MessageId | null
  baseKey: string
  nextSegmentIndex: number
}

type ProposedPlanBuffer = {
  createdAt: string
  text: string
}

export class BoundedTtlCache<Key, Value> {
  private readonly capacity: number
  private readonly entries = new Map<Key, CacheEntry<Value>>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(options: { capacity: number; now?: () => number; ttlMs: number }) {
    this.capacity = options.capacity
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs
  }

  get(key: Key) {
    // Expiry is lazy per key; sweeping the whole cache made every streaming read O(n).
    return readFreshEntry(this.entries, key, this.now)?.value
  }

  set(key: Key, value: Value) {
    this.entries.delete(key)
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, value })
    trimEntriesToCapacity(this.entries, this.capacity)
  }

  delete(key: Key) {
    this.entries.delete(key)
  }

  has(key: Key) {
    return this.get(key) !== undefined
  }

  keys() {
    purgeExpiredEntries(this.entries, this.now)
    return Array.from(this.entries.keys())
  }
}

export class ProviderRuntimeBuffers {
  private readonly assistantMessageIdsByTurn: BoundedTtlCache<string, Set<MessageId>>
  private readonly assistantSegmentStateByTurn: BoundedTtlCache<string, AssistantSegmentState>
  private readonly bufferedAssistantTextByMessageId: BoundedTtlCache<MessageId, string>
  private readonly lastDeliveryAt: BoundedTtlCache<MessageId, number>
  private readonly bufferedProposedPlanById: BoundedTtlCache<string, ProposedPlanBuffer>

  constructor(options: { now?: () => number } = {}) {
    const cacheOptions = { now: options.now, ttlMs: PROVIDER_RUNTIME_BUFFER_TTL_MS }
    this.assistantMessageIdsByTurn = new BoundedTtlCache({
      ...cacheOptions,
      capacity: ASSISTANT_MESSAGE_IDS_BY_TURN_CAPACITY,
    })
    this.assistantSegmentStateByTurn = new BoundedTtlCache({
      ...cacheOptions,
      capacity: ASSISTANT_MESSAGE_IDS_BY_TURN_CAPACITY,
    })
    this.bufferedAssistantTextByMessageId = new BoundedTtlCache({
      ...cacheOptions,
      capacity: BUFFERED_ASSISTANT_TEXT_BY_MESSAGE_ID_CAPACITY,
    })
    this.lastDeliveryAt = new BoundedTtlCache({
      ...cacheOptions,
      capacity: BUFFERED_ASSISTANT_TEXT_BY_MESSAGE_ID_CAPACITY,
    })
    this.bufferedProposedPlanById = new BoundedTtlCache({
      ...cacheOptions,
      capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CAPACITY,
    })
  }

  rememberAssistantMessageId(sessionId: SessionId, turnId: TurnId, messageId: MessageId) {
    const key = turnCacheKey(sessionId, turnId)
    const messageIds = this.assistantMessageIdsByTurn.get(key) ?? new Set<MessageId>()
    messageIds.add(messageId)
    this.assistantMessageIdsByTurn.set(key, messageIds)
  }

  forgetAssistantMessageId(sessionId: SessionId, turnId: TurnId, messageId: MessageId) {
    const key = turnCacheKey(sessionId, turnId)
    const messageIds = this.assistantMessageIdsByTurn.get(key)
    if (!messageIds) return

    messageIds.delete(messageId)
    if (messageIds.size === 0) {
      this.assistantMessageIdsByTurn.delete(key)
      return
    }

    this.assistantMessageIdsByTurn.set(key, messageIds)
  }

  assistantMessageIdsForTurn(sessionId: SessionId, turnId: TurnId) {
    return new Set(this.assistantMessageIdsByTurn.get(turnCacheKey(sessionId, turnId)) ?? [])
  }

  clearAssistantMessageIdsForTurn(sessionId: SessionId, turnId: TurnId) {
    this.assistantMessageIdsByTurn.delete(turnCacheKey(sessionId, turnId))
  }

  activeAssistantMessageIdForTurn(sessionId: SessionId, turnId: TurnId) {
    return this.assistantSegmentStateByTurn.get(turnCacheKey(sessionId, turnId))?.activeMessageId
  }

  getOrCreateAssistantMessageId(input: {
    baseKey: string
    sessionId: SessionId
    turnId: TurnId | undefined
  }) {
    const baseKey = [input.sessionId, input.turnId ?? '', input.baseKey]
      .map(encodeURIComponent)
      .join(':')
    if (!input.turnId) return assistantSegmentMessageId(baseKey, 0)

    const activeMessageId = this.activeAssistantMessageIdForTurn(input.sessionId, input.turnId)
    if (activeMessageId) return activeMessageId

    return this.startAssistantSegmentForTurn(input.sessionId, input.turnId, baseKey)
  }

  markActiveAssistantSegmentComplete(sessionId: SessionId, turnId: TurnId) {
    const key = turnCacheKey(sessionId, turnId)
    const state = this.assistantSegmentStateByTurn.get(key)
    if (!state) return

    this.assistantSegmentStateByTurn.set(key, { ...state, activeMessageId: null })
  }

  clearAssistantSegmentStateForTurn(sessionId: SessionId, turnId: TurnId) {
    this.assistantSegmentStateByTurn.delete(turnCacheKey(sessionId, turnId))
  }

  appendBufferedAssistantText(
    messageId: MessageId,
    delta: string,
    mode: Exclude<ResponseStreamingMode, 'token'> = 'turn',
    atMillis = Date.now(),
  ) {
    const nextText = `${this.bufferedAssistantTextByMessageId.get(messageId) ?? ''}${delta}`
    const { ready, rest } =
      mode === 'paragraph' ? splitBufferedAssistantText(nextText) : { ready: '', rest: nextText }
    const last = this.lastDeliveryAt.get(messageId)
    const paced = last === undefined || atMillis - last >= MIN_ASSISTANT_DELIVERY_INTERVAL_MS
    if (paced && ready.trim().length > 0 && rest.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
      if (rest.length) this.bufferedAssistantTextByMessageId.set(messageId, rest)
      else this.bufferedAssistantTextByMessageId.delete(messageId)
      this.lastDeliveryAt.set(messageId, atMillis)
      return ready
    }
    if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
      this.bufferedAssistantTextByMessageId.set(messageId, nextText)
      return ''
    }

    this.bufferedAssistantTextByMessageId.delete(messageId)
    return nextText
  }

  takeBufferedAssistantText(messageId: MessageId) {
    const text = this.bufferedAssistantTextByMessageId.get(messageId) ?? ''
    this.bufferedAssistantTextByMessageId.delete(messageId)
    return text
  }

  clearBufferedAssistantText(messageId: MessageId) {
    this.lastDeliveryAt.delete(messageId)
    this.bufferedAssistantTextByMessageId.delete(messageId)
  }

  appendBufferedProposedPlan(planId: string, delta: string, createdAt: string) {
    const existing = this.bufferedProposedPlanById.get(planId)
    this.bufferedProposedPlanById.set(planId, {
      createdAt: existing?.createdAt || createdAt,
      text: `${existing?.text ?? ''}${delta}`,
    })
  }

  takeBufferedProposedPlan(planId: string) {
    const buffer = this.bufferedProposedPlanById.get(planId)
    this.bufferedProposedPlanById.delete(planId)
    return buffer
  }

  clearBufferedProposedPlan(planId: string) {
    this.bufferedProposedPlanById.delete(planId)
  }

  clearTurnStateForSession(sessionId: SessionId) {
    const turnPrefix = `${sessionId}:`
    for (const key of this.assistantMessageIdsByTurn.keys()) {
      this.clearTurnMessageKey(key, turnPrefix)
    }
    for (const key of this.assistantSegmentStateByTurn.keys()) {
      if (key.startsWith(turnPrefix)) this.assistantSegmentStateByTurn.delete(key)
    }
    for (const key of this.bufferedProposedPlanById.keys()) {
      if (key.startsWith(proposedPlanPrefix(sessionId))) this.bufferedProposedPlanById.delete(key)
    }
  }

  private startAssistantSegmentForTurn(sessionId: SessionId, turnId: TurnId, baseKey: string) {
    const key = turnCacheKey(sessionId, turnId)
    const existing = this.assistantSegmentStateByTurn.get(key)
    const state = nextAssistantSegmentState(existing, baseKey)
    this.assistantSegmentStateByTurn.set(key, state)
    return state.activeMessageId as MessageId
  }

  private clearTurnMessageKey(key: string, prefix: string) {
    if (!key.startsWith(prefix)) return

    const messageIds = this.assistantMessageIdsByTurn.get(key) ?? new Set<MessageId>()
    for (const messageId of messageIds) {
      this.clearBufferedAssistantText(messageId)
    }
    this.assistantMessageIdsByTurn.delete(key)
  }
}

function nextAssistantSegmentState(
  existing: AssistantSegmentState | undefined,
  baseKey: string,
): AssistantSegmentState {
  if (!existing) return firstAssistantSegmentState(baseKey)

  const segmentIndex = existing.baseKey === baseKey ? existing.nextSegmentIndex : 0
  return {
    activeMessageId: assistantSegmentMessageId(baseKey, segmentIndex),
    baseKey,
    nextSegmentIndex: existing.baseKey === baseKey ? existing.nextSegmentIndex + 1 : 1,
  }
}

function firstAssistantSegmentState(baseKey: string): AssistantSegmentState {
  return {
    activeMessageId: assistantSegmentMessageId(baseKey, 0),
    baseKey,
    nextSegmentIndex: 1,
  }
}

function assistantSegmentMessageId(baseKey: string, segmentIndex: number) {
  const suffix = segmentIndex === 0 ? '' : `:segment:${segmentIndex}`
  return v.parse(messageIdSchema, `assistant:${baseKey}${suffix}`)
}

function turnCacheKey(sessionId: SessionId, turnId: TurnId) {
  return `${sessionId}:${turnId}`
}

function proposedPlanPrefix(sessionId: SessionId) {
  return `plan:${sessionId}:`
}
