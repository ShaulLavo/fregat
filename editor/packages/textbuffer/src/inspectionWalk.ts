export type InspectionTree<N> = { readonly left: N | null; readonly right: N | null }

export type WalkEntry<N> = {
  readonly node: N
  readonly parent: N | null
  readonly edge: 'root' | 'left' | 'right'
  readonly depth: number
}

// Exit frames keep cycle detection path-local without copying a path at every node.
export function walkInspectionTree<N extends InspectionTree<N>>(
  root: N | null,
  enter: (entry: WalkEntry<N>) => void,
  leave: (node: N) => void,
  repeated: (entry: WalkEntry<N>, cycle: boolean) => void,
): void {
  if (!root) return
  const active = new Set<N>()
  const seen = new Set<N>()
  const stack: Array<{ kind: 'enter'; entry: WalkEntry<N> } | { kind: 'leave'; node: N }> = [
    { kind: 'enter', entry: { node: root, parent: null, edge: 'root', depth: 0 } },
  ]
  while (stack.length) {
    const frame = stack.pop()!
    if (frame.kind === 'leave') {
      leave(frame.node)
      active.delete(frame.node)
      continue
    }
    const { node, depth } = frame.entry
    if (seen.has(node)) {
      repeated(frame.entry, active.has(node))
      continue
    }
    active.add(node)
    seen.add(node)
    enter(frame.entry)
    stack.push({ kind: 'leave', node })
    if (node.right)
      stack.push({
        kind: 'enter',
        entry: { node: node.right, parent: node, edge: 'right', depth: depth + 1 },
      })
    if (node.left)
      stack.push({
        kind: 'enter',
        entry: { node: node.left, parent: node, edge: 'left', depth: depth + 1 },
      })
  }
}

export function createInspectionLabels(): (node: object) => string {
  const labels = new WeakMap<object, string>()
  let sequence = 0
  return (node) => {
    const existing = labels.get(node)
    if (existing) return existing
    const label = `n${++sequence}`
    labels.set(node, label)
    return label
  }
}
