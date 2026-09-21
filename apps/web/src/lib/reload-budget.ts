import type * as v from 'valibot'

export const RELOAD_MAX_BYTES = 2 * 1024 * 1024

type Budget = {
  startedAt: number
  parsedBytes: number
  reusedBytes: number
  refusedBytes: number
  readMs: number
  preparationMs: number
  records: number
  reused: number
  refused: number
  parsed: Map<string, { schema: v.GenericSchema; value: unknown }>
}
let active: Budget | null = null

export function beginReloadBudget() {
  active = {
    startedAt: performance.now(),
    parsedBytes: 0,
    reusedBytes: 0,
    refusedBytes: 0,
    readMs: 0,
    preparationMs: 0,
    records: 0,
    reused: 0,
    refused: 0,
    parsed: new Map(),
  }
}

export function admitReloadRecord(serialized: string, schema: v.GenericSchema) {
  if (!active) return { kind: 'read' as const }
  const bytes = serialized.length * 2
  const cached = active.parsed.get(serialized)
  if (cached?.schema === schema) {
    active.reusedBytes += bytes
    active.reused += 1
    return { kind: 'cached' as const, value: cached.value }
  }
  if (active.parsedBytes + bytes > RELOAD_MAX_BYTES) {
    active.refused += 1
    active.refusedBytes += bytes
    return { kind: 'refused' as const }
  }
  active.parsedBytes += bytes
  active.records += 1
  return { kind: 'read' as const }
}

export function rememberReloadRecord(serialized: string, schema: v.GenericSchema, value: unknown) {
  active?.parsed.set(serialized, { schema, value })
}

export function measureReloadRead(startedAt: number) {
  if (active) active.readMs += performance.now() - startedAt
}

export function prepareWithinReloadBudget<T>(prepare: () => T): T {
  const startedAt = performance.now()
  const readsBefore = active?.readMs ?? 0
  const value = prepare()
  if (active)
    active.preparationMs += Math.max(
      0,
      performance.now() - startedAt - (active.readMs - readsBefore),
    )
  return value
}

export function finishReloadBudget() {
  const budget = active
  if (!budget) return null
  active = null
  const { parsed, startedAt, ...metrics } = budget
  parsed.clear()
  const report = {
    ...metrics,
    maxBytes: RELOAD_MAX_BYTES,
    firstCommitMs: performance.now() - startedAt,
  }
  performance.measure('workspace.reload.aggregate', { start: startedAt, detail: report })
  return report
}
