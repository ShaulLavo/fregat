import * as v from 'valibot'
import type { UpdateIntent } from '@/features/server-update/state/intent'

export type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_KEY = 'fregat.update-intent'
const targetSchema = v.object({
  release: v.pipe(v.string(), v.minLength(1)),
  stagedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
})
const persistedSchema = v.variant('kind', [
  v.object({ kind: v.literal('waiting'), target: targetSchema }),
  v.object({ kind: v.literal('reload'), target: targetSchema }),
  v.object({
    kind: v.literal('restarting'),
    target: targetSchema,
    instance: v.nullable(v.string()),
    fromRelease: v.nullable(v.string()),
    startedAt: v.pipe(v.number(), v.finite(), v.minValue(0)),
  }),
])

export function initiatingWindowStorage(): IntentStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function clearPersistedIntent(storage: IntentStorage | null): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // A window with blocked storage still owns its live in-memory operation.
  }
}

export function restoreUpdateIntent(
  storage: IntentStorage | null,
  now: number,
  restartTimeoutMs: number,
): UpdateIntent {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return { kind: 'idle' }
    const parsed = v.safeParse(persistedSchema, JSON.parse(raw))
    if (!parsed.success) {
      clearPersistedIntent(storage)
      return { kind: 'idle' }
    }
    const intent = parsed.output
    if (intent.kind === 'waiting') return { ...intent, busy: [], gateReadAt: 0 }
    if (intent.kind === 'reload') return intent
    if (intent.startedAt > now || now >= intent.startedAt + restartTimeoutMs) {
      clearPersistedIntent(storage)
      return { kind: 'failed', target: intent.target, reason: 'timeout' }
    }
    // Recovery observes the server; interruption consent only lives in the initiating document.
    return { ...intent, confirmed: false }
  } catch {
    clearPersistedIntent(storage)
    return { kind: 'idle' }
  }
}

export function persistUpdateIntent(storage: IntentStorage | null, intent: UpdateIntent): void {
  if (
    intent.kind === 'idle' ||
    intent.kind === 'confirm' ||
    intent.kind === 'failed' ||
    intent.kind === 'navigating'
  ) {
    clearPersistedIntent(storage)
    return
  }
  const persisted =
    intent.kind === 'restarting'
      ? {
          kind: intent.kind,
          target: intent.target,
          instance: intent.instance,
          fromRelease: intent.fromRelease,
          startedAt: intent.startedAt,
        }
      : { kind: intent.kind, target: intent.target }
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    clearPersistedIntent(storage)
  }
}
