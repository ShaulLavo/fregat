import { sessionIdentityErrors } from './structured-errors'
import { and, asc, eq, lt } from 'drizzle-orm'
import {
  DEFAULT_RUNTIME_MODE,
  providerDriverKindSchema,
  providerInstanceIdSchema,
  runtimeModeSchema,
  sessionIdSchema,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type RuntimeMode,
  type SessionId,
  type SessionRuntimeStatus,
} from '@workspace/contracts'
import * as v from 'valibot'
import { getDefaultPlatformDatabase } from '../db/client'
import {
  projectionSessionRuntime,
  providerSessionRuntime,
  type ProviderSessionRuntimeRow,
} from '../db/schema'
import type { OrchestrationDatabase } from '../orchestration/event-store'
import { createInternalError } from '../observability/structured-errors'
import {
  providerSessionRuntimePayloadSchema,
  type ProviderSessionRuntimePayload,
} from './session-payload'

export type ProviderRuntimeBinding = {
  adapterKey?: string
  providerDriverKind: ProviderDriverKind
  providerInstanceId?: ProviderInstanceId
  providerBindingHandle?: string | null
  providerConversationMarker?: string | null
  providerResumeCursor?: unknown | null
  runtimeEpoch?: string
  runtimeMode?: RuntimeMode
  runtimePayload?: ProviderSessionRuntimePayload | null
  sessionId: SessionId
}

export type ProviderRuntimeBindingWithMetadata = {
  adapterKey: string
  lastSeenAt: string
  providerDriverKind: ProviderDriverKind
  providerInstanceId: ProviderInstanceId
  providerBindingHandle: string | null
  providerConversationMarker: string | null
  providerResumeCursor: unknown | null
  runtimeEpoch: string
  runtimeMode: RuntimeMode
  runtimePayload: ProviderSessionRuntimePayload | null
  sessionId: SessionId
}

const LIVENESS_WRITE_THROTTLE_MS = 5_000

export class ProviderSessionDirectory {
  private readonly database: OrchestrationDatabase
  private readonly lastSeenWriteAtMs = new Map<SessionId, number>()
  private readonly now: () => number

  constructor(
    database: OrchestrationDatabase = getDefaultPlatformDatabase(),
    options: { now?: () => number } = {},
  ) {
    this.database = database
    this.now = options.now ?? Date.now
  }

  upsert(binding: ProviderRuntimeBinding): ProviderRuntimeBindingWithMetadata {
    const existing = this.findRow(binding.sessionId)
    const resolved = resolveBindingForWrite(binding, existing, this.now())
    const values = bindingToRowValues(resolved)
    this.database
      .insert(providerSessionRuntime)
      .values(values)
      .onConflictDoUpdate({
        target: providerSessionRuntime.sessionId,
        set: values,
      })
      .run()
    this.lastSeenWriteAtMs.set(binding.sessionId, this.now())
    return resolved
  }

  getBinding(sessionId: SessionId): ProviderRuntimeBindingWithMetadata | null {
    const row = this.findRow(sessionId)
    return row ? rowToBinding(row) : null
  }

  getProvider(sessionId: SessionId) {
    return this.getBinding(sessionId)?.providerDriverKind ?? null
  }

  listSessionIds() {
    return this.listBindings().map((binding) => binding.sessionId)
  }

  listBindings() {
    return this.database
      .select()
      .from(providerSessionRuntime)
      .orderBy(asc(providerSessionRuntime.sessionId))
      .all()
      .map(rowToBinding)
  }

  listIdleSince(cutoffIso: string, status: SessionRuntimeStatus) {
    return this.database
      .select({ binding: providerSessionRuntime })
      .from(providerSessionRuntime)
      .innerJoin(
        projectionSessionRuntime,
        and(
          eq(projectionSessionRuntime.sessionId, providerSessionRuntime.sessionId),
          eq(projectionSessionRuntime.runtimeEpoch, providerSessionRuntime.runtimeEpoch),
        ),
      )
      .where(
        and(
          lt(providerSessionRuntime.lastSeenAt, cutoffIso),
          eq(projectionSessionRuntime.status, status),
        ),
      )
      .orderBy(asc(providerSessionRuntime.lastSeenAt), asc(providerSessionRuntime.sessionId))
      .all()
      .map(({ binding }) => rowToBinding(binding))
  }

  markSeen(sessionId: SessionId) {
    const now = this.now()
    const wroteAt = this.lastSeenWriteAtMs.get(sessionId)
    if (wroteAt !== undefined && now - wroteAt < LIVENESS_WRITE_THROTTLE_MS) return

    this.lastSeenWriteAtMs.set(sessionId, now)
    this.database
      .update(providerSessionRuntime)
      .set({ lastSeenAt: new Date(now).toISOString() })
      .where(eq(providerSessionRuntime.sessionId, sessionId))
      .run()
  }

  private findRow(sessionId: SessionId) {
    return this.database
      .select()
      .from(providerSessionRuntime)
      .where(eq(providerSessionRuntime.sessionId, sessionId))
      .get()
  }
}

function resolveBindingForWrite(
  binding: ProviderRuntimeBinding,
  existing: ProviderSessionRuntimeRow | undefined,
  nowMs: number,
): ProviderRuntimeBindingWithMetadata {
  const providerInstanceId = binding.providerInstanceId ?? existing?.providerInstanceId
  const runtimeEpoch = binding.runtimeEpoch ?? existing?.runtimeEpoch
  if (existing && providerInstanceId !== existing.providerInstanceId)
    throw sessionIdentityErrors.SESSION_PROVIDER_CONFLICT({
      internal: {
        at: 'directory-merge',
        boundTo: existing.providerInstanceId,
        requested: providerInstanceId ?? null,
      },
    })
  if (!providerInstanceId || !runtimeEpoch)
    throw createInternalError('A provider binding requires its instance and runtime epoch.')
  const previous = existing ? rowToBinding(existing) : null
  const runtimePayload = mergeRuntimePayload(
    previous?.runtimePayload ?? null,
    binding.runtimePayload,
  )

  return {
    adapterKey: binding.adapterKey ?? existing?.adapterKey ?? binding.providerDriverKind,
    lastSeenAt: new Date(nowMs).toISOString(),
    providerDriverKind: binding.providerDriverKind,
    providerInstanceId: v.parse(providerInstanceIdSchema, providerInstanceId),
    providerBindingHandle: fieldOrPrevious(
      binding.providerBindingHandle,
      previous?.providerBindingHandle,
    ),
    providerConversationMarker: fieldOrPrevious(
      binding.providerConversationMarker,
      previous?.providerConversationMarker,
    ),
    providerResumeCursor: fieldOrPrevious(
      binding.providerResumeCursor,
      previous?.providerResumeCursor,
    ),
    runtimeEpoch,
    runtimeMode: binding.runtimeMode ?? previous?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    runtimePayload,
    sessionId: binding.sessionId,
  }
}

function fieldOrPrevious<T>(value: T | undefined, previous: T | undefined): T | null {
  if (value !== undefined) return value
  return previous ?? null
}

function rowToBinding(row: ProviderSessionRuntimeRow): ProviderRuntimeBindingWithMetadata {
  return {
    adapterKey: row.adapterKey,
    lastSeenAt: row.lastSeenAt,
    providerDriverKind: v.parse(providerDriverKindSchema, row.providerDriverKind),
    providerInstanceId: v.parse(providerInstanceIdSchema, row.providerInstanceId),
    providerBindingHandle: row.providerBindingHandle,
    providerConversationMarker: row.providerConversationMarker,
    providerResumeCursor:
      row.providerResumeCursorJson === null ? null : JSON.parse(row.providerResumeCursorJson),
    runtimeEpoch: row.runtimeEpoch,
    runtimeMode: v.parse(runtimeModeSchema, row.runtimeMode),
    runtimePayload:
      row.runtimePayloadJson === null
        ? null
        : v.parse(providerSessionRuntimePayloadSchema, JSON.parse(row.runtimePayloadJson)),
    sessionId: v.parse(sessionIdSchema, row.sessionId),
  }
}

function mergeRuntimePayload(
  existing: ProviderSessionRuntimePayload | null,
  next: ProviderSessionRuntimePayload | null | undefined,
) {
  if (next === undefined) return existing
  if (next === null) return null
  return { ...existing, ...next }
}

function bindingToRowValues(binding: ProviderRuntimeBindingWithMetadata) {
  return {
    adapterKey: binding.adapterKey,
    lastSeenAt: binding.lastSeenAt,
    providerDriverKind: binding.providerDriverKind,
    providerInstanceId: binding.providerInstanceId,
    providerBindingHandle: binding.providerBindingHandle,
    providerConversationMarker: binding.providerConversationMarker,
    runtimeEpoch: binding.runtimeEpoch,
    providerResumeCursorJson:
      binding.providerResumeCursor === null ? null : JSON.stringify(binding.providerResumeCursor),
    runtimeMode: binding.runtimeMode,
    runtimePayloadJson:
      binding.runtimePayload === null ? null : JSON.stringify(binding.runtimePayload),
    sessionId: binding.sessionId,
  }
}
