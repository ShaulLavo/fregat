import * as v from 'valibot'
import type { DrainContext } from 'evlog'
import { createRecordSanitizer, limitDiagnosticString } from '@workspace/observability/sanitize'
import type { SettingsValues } from '@workspace/contracts'

const entrySchema = v.object({
  instanceId: v.string(),
  event: v.looseObject({
    eventId: v.string(),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    level: v.picklist(['warn', 'error']),
    service: v.string(),
    environment: v.string(),
  }),
})
const sanitize = createRecordSanitizer({
  formatString: limitDiagnosticString,
  extraSensitiveFields: ['stack'],
  limits: { maxArrayItems: 25, maxDepth: 5, maxObjectKeys: 50 },
})

export type Retention = SettingsValues['logs.clientFailureRetention']
export type StoredLog = {
  readonly key: string
  readonly serialized: string
  readonly instanceId: string
  readonly context: DrainContext
}
type LossReason = 'capacity' | 'expired' | 'invalid' | 'storage' | 'delivery'

export function createLogOutbox({
  storage,
  instanceId,
  retention,
  destination,
}: {
  readonly storage: Storage | null
  readonly instanceId: string
  readonly retention: () => Retention
  readonly destination: string
}) {
  const prefix = `platform.client-log.v1:${encodeURIComponent(destination)}:`
  const volatile = new Map<string, StoredLog>()
  const losses: Partial<Record<LossReason, number>> = {}

  function persist(context: DrainContext, diagnostic = false): StoredLog | null {
    const parsed = v.safeParse(entrySchema, { instanceId, event: sanitizedEvent(context.event) })
    if (!parsed.success) {
      if (!diagnostic) recordLoss('invalid', 1)
      return null
    }
    const serialized = JSON.stringify(parsed.output)
    const recordId = diagnostic
      ? `diagnostic:${instanceId}`
      : `event:${instanceId}:${parsed.output.event.eventId}`
    const key = `${prefix}${recordId}`
    const entry = { key, serialized, instanceId, context: { event: parsed.output.event } }
    volatile.set(key, entry)
    try {
      if (!storage) throw new DOMException('Storage unavailable', 'SecurityError')
      storage.setItem(key, serialized)
      volatile.delete(key)
    } catch (failure) {
      if (!diagnostic) recordLoss('storage', 1, failure)
    }
    return entry
  }

  function recordLoss(reason: LossReason, count: number, failure?: unknown) {
    losses[reason] = (losses[reason] ?? 0) + count
    persist(
      {
        event: {
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'platform-web',
          environment: 'browser',
          eventId: crypto.randomUUID(),
          action: 'client.logs.delivery',
          area: 'observability',
          losses: { ...losses },
          lastFailure: deliveryFailure(failure),
        },
      },
      true,
    )
  }

  function remove(entry: StoredLog) {
    if (volatile.get(entry.key)?.serialized === entry.serialized) volatile.delete(entry.key)
    try {
      // An acknowledgement for an older diagnostic must preserve its newer counters.
      if (storage?.getItem(entry.key) === entry.serialized) storage.removeItem(entry.key)
    } catch (failure) {
      recordLoss('storage', 1, failure)
    }
  }

  function readStored(key: string): StoredLog | null {
    let serialized: string | null | undefined
    try {
      serialized = storage?.getItem(key)
    } catch (failure) {
      recordLoss('storage', 1, failure)
      return null
    }
    if (!serialized) return null
    try {
      const parsed = v.safeParse(entrySchema, JSON.parse(serialized))
      if (parsed.success)
        return {
          key,
          serialized,
          instanceId: parsed.output.instanceId,
          context: { event: parsed.output.event },
        }
    } catch {
      // Invalid JSON follows the same removal path as a failed schema parse.
    }
    try {
      storage?.removeItem(key)
    } catch (failure) {
      recordLoss('storage', 1, failure)
    }
    recordLoss('invalid', 1)
    return null
  }

  function read(): StoredLog[] {
    const entries = new Map(volatile)
    try {
      const keys = Array.from({ length: storage?.length ?? 0 }, (_, index) => storage?.key(index))
      for (const key of keys) {
        if (!key?.startsWith(prefix)) continue
        const entry = readStored(key)
        if (entry) entries.set(key, entry)
      }
    } catch (failure) {
      recordLoss('storage', 1, failure)
    }
    return Array.from(entries.values()).sort((a, b) =>
      a.context.event.timestamp.localeCompare(b.context.event.timestamp),
    )
  }

  function pending(): StoredLog[] {
    const limits = retention()
    const cutoff = Date.now() - limits.maxAgeHours * 3_600_000
    const entries = read()
    const kept: StoredLog[] = []
    let bytes = 0
    for (const entry of entries.reverse()) {
      const size = new TextEncoder().encode(entry.serialized).byteLength
      const reason = discardReason(entry, size, cutoff, kept.length, bytes, limits)
      if (reason) {
        remove(entry)
        if (entry.context.event.action !== 'client.logs.delivery') recordLoss(reason, 1)
        continue
      }
      kept.push(entry)
      bytes += size
    }
    return kept.reverse()
  }

  return { persist, pending, remove, recordLoss }
}

function sanitizedEvent(event: Record<string, unknown>) {
  return {
    ...sanitize(event),
    eventId: event.eventId,
    timestamp: event.timestamp,
    level: event.level,
    service: event.service,
    environment: event.environment,
  }
}

function deliveryFailure(failure: unknown) {
  if (!(failure instanceof Error)) return undefined
  const status = /^\[evlog\/http\] Server responded with (\d{3})$/.exec(failure.message)?.[1]
  return { name: failure.name, status: status ? Number(status) : undefined }
}

function discardReason(
  entry: StoredLog,
  size: number,
  cutoff: number,
  count: number,
  bytes: number,
  limits: Retention,
): LossReason | null {
  if (Date.parse(entry.context.event.timestamp) < cutoff) return 'expired'
  // Fetch keepalive bodies are limited to 64 KiB, including the JSON envelope.
  if (size > 60_000 || count >= limits.maxEvents || bytes + size > limits.maxBytes)
    return 'capacity'
  return null
}
