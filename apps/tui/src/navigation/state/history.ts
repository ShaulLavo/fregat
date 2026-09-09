import type { AgentLocation } from '@/agent/utils/target'
import type { WorkbenchLocation } from '@/workbench/utils/location'

export type Location =
  | AgentLocation
  | { readonly kind: 'settings'; readonly query: string }
  | {
      readonly kind: 'files'
      readonly path: string
      readonly rootPath: string
      readonly query?: string
      readonly workbenchRoot?: string
    }
  | WorkbenchLocation

function equal(left: Location, right: Location) {
  if (left.kind === 'agent')
    return (
      right.kind === 'agent' &&
      left.sessionId === right.sessionId &&
      left.projectId === right.projectId &&
      (left.worktreeId ?? null) === (right.worktreeId ?? null)
    )
  if (left.kind === 'settings') return right.kind === 'settings' && left.query === right.query
  if (left.kind === 'workbench')
    return (
      right.kind === 'workbench' &&
      left.rootPath === right.rootPath &&
      left.path === right.path &&
      left.line === right.line &&
      left.pane === right.pane &&
      left.tree === right.tree
    )
  return (
    right.kind === 'files' &&
    left.path === right.path &&
    left.rootPath === right.rootPath &&
    left.query === right.query &&
    left.workbenchRoot === right.workbenchRoot
  )
}

export type NavigationHistory = ReturnType<typeof createHistory>

export function createHistory(initial: Location) {
  let entries: readonly Location[] = [initial]
  let index = 0
  let snapshot = { current: initial, canGoBack: false, canGoForward: false }
  const listeners = new Set<() => void>()
  function publish() {
    snapshot = {
      current: entries[index],
      canGoBack: index > 0,
      canGoForward: index < entries.length - 1,
    }
    for (const listener of listeners) listener()
    return snapshot.current
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    visit(location: Location) {
      if (equal(entries[index], location)) return
      entries = [...entries.slice(0, index + 1), location]
      index = entries.length - 1
      publish()
    },
    replace(location: Location) {
      if (equal(entries[index], location)) return
      entries = entries.map((entry, position) => (position === index ? location : entry))
      publish()
    },
    go(direction: -1 | 1) {
      const next = index + direction
      if (next < 0 || next >= entries.length) return null
      index = next
      return publish()
    },
  }
}
