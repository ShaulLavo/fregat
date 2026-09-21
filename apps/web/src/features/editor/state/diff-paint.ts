import type { QueryClient } from '@tanstack/react-query'
import type { DiffFile, DiffGutterSide } from '@singapore-editor/diff'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import * as v from 'valibot'

const KEY = 'diff.paint.v1'
const DIFF_PAINT_MAX_BYTES = 327_680
const paneSchema = v.object({
  side: v.picklist(['old', 'new', 'stacked']),
  paint: v.pipe(v.string(), v.maxLength(81_920)),
  expansion: v.pipe(v.array(v.string()), v.maxLength(1000)),
})
const schema = v.object({
  root: v.nullable(v.string()),
  identity: v.string(),
  file: v.string(),
  layout: v.optional(v.record(v.string(), v.number())),
  panes: v.pipe(v.array(paneSchema), v.maxLength(3)),
})
type Saved = v.InferOutput<typeof schema>
type Owner = { root: string | null; storage: ScopedStorage; saved: Saved | null }
const owners = new WeakMap<QueryClient, Owner>()
const listeners = new Set<() => void>()
export function subscribeDiffPaint(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function diffPaintOwner(owner: QueryClient) {
  return owners.get(owner)
}
export function prepareDiffPaintReload(
  owner: QueryClient,
  storage: ScopedStorage,
  root: string | null,
) {
  const record = readReloadCache<Saved>(KEY, schema, storage, DIFF_PAINT_MAX_BYTES)
  owners.set(owner, { root, storage, saved: record?.root === root ? record : null })
  for (const listener of listeners) listener()
}

function diffFileIdentity(file: DiffFile): string | null {
  if (!file.oldObjectId && !file.newObjectId) return null
  return JSON.stringify([
    file.path,
    file.oldPath,
    file.newPath,
    file.oldObjectId,
    file.newObjectId,
    file.isPartial,
  ])
}

export function savedDiffPaint(
  state: Owner | undefined,
  identity: string | undefined,
  side: DiffGutterSide,
  file: DiffFile | null,
  expansion: readonly string[],
) {
  const saved = state?.saved
  if (!identity || saved?.identity !== identity) return null
  if (file && saved.file !== diffFileIdentity(file)) return null
  const pane = saved.panes.find((pane) => pane.side === side)
  if (!pane) return null
  if (file && expansion.length > 0 && JSON.stringify(pane.expansion) !== JSON.stringify(expansion))
    return null
  return pane.paint
}

export function hasSavedDiffPaint(
  state: Owner | undefined,
  identity: string | undefined,
  mode: 'split' | 'stacked',
) {
  if (!identity || state?.saved?.identity !== identity) return false
  const sides = new Set(state.saved.panes.map((pane) => pane.side))
  if (mode === 'stacked') return sides.has('stacked')
  return sides.has('old') && sides.has('new')
}

export function savedDiffPaintView(state: Owner | undefined, identity: string | undefined) {
  return identity && state?.saved?.identity === identity ? state.saved : null
}

export function captureDiffPaint(
  owner: QueryClient,
  target: Owner | undefined,
  identity: string,
  file: DiffFile,
  side: DiffGutterSide,
  expansion: readonly string[],
  paint: string,
  layout?: Record<string, number>,
) {
  if (!target || owners.get(owner) !== target || paint.length > 81_920 || expansion.length > 1000)
    return
  const key = diffFileIdentity(file)
  if (!key) return
  const prior =
    target.saved?.identity === identity && target.saved.file === key ? target.saved.panes : []
  const panes = prior.filter(
    (pane) => pane.side !== side && side !== 'stacked' && pane.side !== 'stacked',
  )
  panes.push({ side, paint, expansion: [...expansion] })
  const saved = { root: target.root, identity, file: key, panes, layout }
  const result = writeWorkspaceCacheEntry(KEY, saved, {
    storage: target.storage,
    maxSerializedBytes: DIFF_PAINT_MAX_BYTES,
  })
  if (result.status !== 'written') {
    target.storage.removeItem(KEY)
    return
  }
  target.saved = saved
}
