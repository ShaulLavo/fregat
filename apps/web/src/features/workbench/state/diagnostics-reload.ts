import type { QueryClient } from '@tanstack/react-query'
import type { LanguageServerDiagnosticSummary } from '@singapore-editor/lsp-plugin/websocket'
import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'
import * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'

const KEY = 'diagnostics.display.v1'
const DIAGNOSTICS_RELOAD_MAX_BYTES = 131_072
const position = v.object({ line: v.number(), character: v.number() })
const diagnostic = v.object({
  range: v.object({ start: position, end: position }),
  message: v.pipe(v.string(), v.maxLength(8192)),
  severity: v.optional(v.union([v.literal(1), v.literal(2), v.literal(3), v.literal(4)])),
  source: v.optional(v.string()),
  code: v.optional(v.union([v.string(), v.number()])),
})
const schema = v.object({
  root: v.nullable(v.string()),
  path: v.string(),
  revision: v.string(),
  observedAt: v.number(),
  uri: v.nullable(v.string()),
  version: v.nullable(v.number()),
  diagnostics: v.pipe(v.array(diagnostic), v.maxLength(200)),
  scrollTop: v.number(),
})
type Record = v.InferOutput<typeof schema>
type Owner = {
  root: string | null
  storage: ScopedStorage
  saved: Record | null
  summary: LanguageServerDiagnosticSummary | null
}
const owners = new WeakMap<QueryClient, Owner>()
const listeners = new Set<() => void>()
export function subscribeDiagnosticsReload(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function prepareDiagnosticsReload(
  owner: QueryClient,
  storage: ScopedStorage,
  root: string | null,
) {
  const record = readReloadCache<Record>(KEY, schema, storage, DIAGNOSTICS_RELOAD_MAX_BYTES)
  const saved = record?.root === root ? record : null
  owners.set(owner, {
    root,
    storage,
    saved,
    summary: saved ? summarizeDiagnostics(saved.uri, saved.version, saved.diagnostics) : null,
  })
  for (const listener of listeners) listener()
}

export function diagnosticsReloadOwner(owner: QueryClient) {
  return owners.get(owner)
}

export function savedDiagnostics(
  owner: QueryClient,
  path: string | null,
  revision: string | null,
  changed: boolean,
  state = owners.get(owner),
) {
  const saved = state?.saved
  if (!state || !saved || saved.path !== path) return null
  if (changed || (revision !== null && saved.revision !== revision)) {
    state.saved = null
    state.summary = null
    state.storage.removeItem(KEY)
    return null
  }
  return { summary: state.summary, scrollTop: saved.scrollTop }
}

export function captureDiagnostics(
  owner: QueryClient,
  expected: ReturnType<typeof diagnosticsReloadOwner>,
  path: string,
  revision: string,
  summary: LanguageServerDiagnosticSummary,
  scrollTop: number,
) {
  const state = owners.get(owner)
  if (!state || state !== expected || summary.diagnostics.length > 200) return
  let characters = 0
  const diagnostics = []
  for (const item of summary.diagnostics) {
    const message = typeof item.message === 'string' ? item.message : item.message.value
    characters += message.length
    if (characters > 48_000 || message.length > 8192) return
    diagnostics.push({
      range: item.range,
      message,
      severity: item.severity,
      source: item.source,
      code: item.code,
    })
  }
  const record = {
    root: state.root,
    path,
    revision,
    observedAt: Date.now(),
    uri: summary.uri,
    version: summary.version,
    diagnostics,
    scrollTop,
  }
  const parsed = v.safeParse(schema, record)
  if (!parsed.success) return
  const result = writeWorkspaceCacheEntry(KEY, parsed.output, {
    storage: state.storage,
    maxSerializedBytes: DIAGNOSTICS_RELOAD_MAX_BYTES,
  })
  if (result.status !== 'written') {
    state.storage.removeItem(KEY)
    return
  }
  state.saved = parsed.output
  state.summary = summary
}

export function captureDiagnosticsScroll(
  owner: QueryClient,
  expected: ReturnType<typeof diagnosticsReloadOwner>,
  path: string,
  scrollTop: number,
) {
  const state = owners.get(owner)
  if (!state || state !== expected || state.saved?.path !== path) return
  const record = { ...state.saved, scrollTop }
  const result = writeWorkspaceCacheEntry(KEY, record, {
    storage: state.storage,
    maxSerializedBytes: DIAGNOSTICS_RELOAD_MAX_BYTES,
  })
  if (result.status === 'written') state.saved = record
}
