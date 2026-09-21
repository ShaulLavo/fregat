import * as v from 'valibot'
import type { QueryClient } from '@tanstack/react-query'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'

const KEY = 'terminal.display.v1'
export const TERMINAL_RELOAD_MAX_BYTES = 270_336
const schema = v.object({
  root: v.string(),
  sessionId: v.string(),
  fontSize: v.number(),
  paletteHash: v.string(),
  paint: v.pipe(v.string(), v.maxLength(131072)),
})
type TerminalDisplay = v.InferOutput<typeof schema>
const owners = new WeakMap<
  QueryClient,
  { root: string | null; storage: ScopedStorage; saved: TerminalDisplay | null }
>()

export function prepareTerminalReload(
  owner: QueryClient,
  storage: ScopedStorage,
  root: string | null,
) {
  const saved = readReloadCache<TerminalDisplay>(KEY, schema, storage, TERMINAL_RELOAD_MAX_BYTES)
  owners.set(owner, { root, storage, saved: saved?.root === root ? saved : null })
}

export function savedTerminal(owner: QueryClient, target: Omit<TerminalDisplay, 'paint'>) {
  const saved = owners.get(owner)?.saved
  return saved &&
    saved.root === target.root &&
    saved.sessionId === target.sessionId &&
    saved.fontSize === target.fontSize &&
    saved.paletteHash === target.paletteHash
    ? saved.paint
    : null
}

export function captureTerminal(
  owner: QueryClient,
  target: Omit<TerminalDisplay, 'paint'>,
  paint: string | undefined,
  generation = terminalReloadGeneration(owner),
) {
  const state = owners.get(owner)
  if (!state || state !== generation || state.root !== target.root) return
  if (!paint) {
    state.saved = null
    state.storage.removeItem(KEY)
    return
  }
  const record = { ...target, paint }
  const result = writeWorkspaceCacheEntry(KEY, record, {
    storage: state.storage,
    maxSerializedBytes: TERMINAL_RELOAD_MAX_BYTES,
  })
  if (result.status === 'oversized') {
    state.saved = null
    state.storage.removeItem(KEY)
    return
  }
  state.saved = record
}

export function terminalReloadGeneration(owner: QueryClient) {
  return owners.get(owner)
}

export function discardTerminal(
  owner: QueryClient,
  target: Omit<TerminalDisplay, 'paint'>,
  paint: string,
) {
  if (savedTerminal(owner, target) !== paint) return
  captureTerminal(owner, target, undefined)
}
