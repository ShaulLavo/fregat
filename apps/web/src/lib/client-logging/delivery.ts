import type { DrainContext } from 'evlog'
import { createHttpDrain } from 'evlog/http'
import { createDrainPipeline } from 'evlog/pipeline'
import { createLogOutbox, type Retention, type StoredLog } from './outbox'

export function createClientLogDelivery({
  endpoint,
  instanceId,
  storage,
  retention,
}: {
  readonly endpoint: string
  readonly instanceId: string
  readonly storage: Storage | null
  readonly retention: () => Retention
}) {
  const target = new URL(endpoint)
  const destination = `${target.origin}${target.pathname}`
  const outbox = createLogOutbox({ storage, instanceId, retention, destination })
  const scheduled = new Set<string>()
  const sendTransient = createHttpDrain({ endpoint, credentials: 'omit' })
  const transient = createDrainPipeline<DrainContext>({
    batch: { size: 25, intervalMs: 2000 },
    retry: { maxAttempts: 2 },
    maxBufferSize: 1000,
    onDropped: (events, failure) => outbox.recordLoss('delivery', events.length, failure),
  })(async (events) => {
    await sendTransient(events)
    if (globalThis.document?.visibilityState !== 'hidden') replay()
  })
  // Logging uses evlog's transport queue so delivery failures cannot recurse through app mutations.
  const durable = createDrainPipeline<StoredLog>({
    batch: { size: 25, intervalMs: 2000 },
    retry: { maxAttempts: 2 },
    maxBufferSize: 1000,
    onDropped: (entries, failure) => {
      const failures = entries.filter(
        (entry) =>
          scheduled.has(entry.serialized) && entry.context.event.action !== 'client.logs.delivery',
      )
      for (const entry of entries) scheduled.delete(entry.serialized)
      if (failures.length) outbox.recordLoss('delivery', failures.length, failure)
    },
  })(send)

  async function send(entries: readonly StoredLog[]) {
    let group: StoredLog[] = []
    let bytes = 2
    for (const entry of entries.toSorted((a, b) => a.instanceId.localeCompare(b.instanceId))) {
      const size = new TextEncoder().encode(JSON.stringify(entry.context)).byteLength + 1
      if (group.length && (group[0]?.instanceId !== entry.instanceId || bytes + size > 60_000)) {
        await sendGroup(group)
        group = []
        bytes = 2
      }
      group.push(entry)
      bytes += size
    }
    if (group.length) await sendGroup(group)
  }

  async function sendGroup(entries: readonly StoredLog[]) {
    const url = new URL(endpoint)
    url.searchParams.set('instance', entries[0]?.instanceId ?? instanceId)
    await createHttpDrain({ endpoint: url.href, credentials: 'omit', useBeacon: false })(
      entries.map((entry) => entry.context),
    )
    for (const entry of entries) {
      outbox.remove(entry)
      scheduled.delete(entry.serialized)
    }
  }

  function replay() {
    for (const entry of outbox.pending()) {
      if (scheduled.has(entry.serialized)) continue
      scheduled.add(entry.serialized)
      durable(entry)
    }
  }

  function drain(context: DrainContext) {
    if (context.event.level !== 'warn' && context.event.level !== 'error') {
      transient(context)
      return
    }
    outbox.persist(context)
    replay()
  }

  async function flush() {
    replay()
    await Promise.all([durable.flush(), transient.flush()])
  }

  function visible() {
    if (document.visibilityState === 'visible') replay()
    else void flush()
  }

  replay()
  globalThis.window?.addEventListener('online', replay)
  globalThis.window?.addEventListener('focus', replay)
  globalThis.document?.addEventListener('visibilitychange', visible)
  return Object.assign(drain, {
    flush,
    dispose() {
      globalThis.window?.removeEventListener('online', replay)
      globalThis.window?.removeEventListener('focus', replay)
      globalThis.document?.removeEventListener('visibilitychange', visible)
    },
  })
}
