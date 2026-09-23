import { canSplitGroup, type GroupSize } from '@/lib/documents/utils/group-layout'
import type { GroupEdge, GroupId, TabPlacement } from '@/lib/documents/utils/group-types'

/** `unknown` is a group with no measured box: not mounted, or not yet observed. */
export type SplitVerdict = 'allowed' | 'too-small' | 'unknown'

const sizes = new Map<GroupId, GroupSize>()
const registered = new Map<Element, GroupId>()
const listeners = new Set<() => void>()
let observer: ResizeObserver | null = null

/** Called from an editor group's ref callback; the returned cleanup is the ref's cleanup. */
export function registerEditorGroup(id: GroupId, element: HTMLElement): () => void {
  registered.set(element, id)
  resizeObserver()?.observe(element)
  return () => {
    observer?.unobserve(element)
    registered.delete(element)
    // A remount registers the new element before the old one's cleanup runs.
    if (Array.from(registered.values()).includes(id)) return

    sizes.delete(id)
    notify()
  }
}

export function groupSplitVerdict(id: GroupId, edge: GroupEdge): SplitVerdict {
  const size = sizes.get(id)
  if (!size) return 'unknown'
  return canSplitGroup(size, edge) ? 'allowed' : 'too-small'
}

/** An unmounted group is not a small one: a split asked for while it is off screen goes ahead. */
export function canPlaceEditorTab(placement: TabPlacement): boolean {
  if (placement.target.kind !== 'edge') return true
  return groupSplitVerdict(placement.target.groupId, placement.target.edge) !== 'too-small'
}

export function subscribeGroupGeometry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function resizeObserver(): ResizeObserver | null {
  if (observer || typeof ResizeObserver === 'undefined') return observer
  observer = new ResizeObserver(record)
  return observer
}

function record(entries: readonly ResizeObserverEntry[]) {
  for (const entry of entries) {
    const id = registered.get(entry.target)
    if (!id) continue

    sizes.set(id, { width: entry.contentRect.width, height: entry.contentRect.height })
  }
  notify()
}

function notify() {
  for (const listener of listeners) listener()
}
