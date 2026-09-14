import {
  getDisplayName,
  instrument,
  isCompositeFiber,
  MutationMask,
  traverseRenderedFibers,
  type Fiber,
} from 'bippy'

type Tally = {
  changes: Map<string, number>
  noDomChange: number
  parentDriven: number
  renders: number
  timeMs: number
}

const FUNCTION_TAGS = new Set([0, 2, 11, 14, 15])
const tallies = new Map<string, Tally>()

instrument({
  name: 'agent-renders',
  onCommitFiberRoot: (_rendererId, root) => {
    traverseRenderedFibers(root, (fiber, phase) => {
      if (phase !== 'update' || !isCompositeFiber(fiber)) return
      const name = getDisplayName(fiber.type) ?? '(anonymous)'
      const tally = tallies.get(name) ?? {
        changes: new Map(),
        noDomChange: 0,
        parentDriven: 0,
        renders: 0,
        timeMs: 0,
      }
      tally.renders += 1
      tally.timeMs += fiber.actualDuration ?? 0
      const changes = changesFor(fiber)
      if (changes.length === 0) tally.parentDriven += 1
      if (!touchesDom(fiber)) tally.noDomChange += 1
      for (const change of changes) {
        tally.changes.set(change, (tally.changes.get(change) ?? 0) + 1)
      }
      tallies.set(name, tally)
    })
  },
})

// What moved between this render and the previous one: props by reference,
// hook state by slot, context by value. The same comparison React makes.
function changesFor(fiber: Fiber): string[] {
  const previous = fiber.alternate
  if (!previous) return []
  const changes: string[] = []
  const props = (fiber.memoizedProps ?? {}) as Record<string, unknown>
  const prevProps = (previous.memoizedProps ?? {}) as Record<string, unknown>
  for (const key of new Set([...Object.keys(props), ...Object.keys(prevProps)])) {
    if (!Object.is(props[key], prevProps[key])) changes.push(`prop:${key}`)
  }
  if (FUNCTION_TAGS.has(fiber.tag)) {
    let hook = fiber.memoizedState as HookLike | null
    let prevHook = previous.memoizedState as HookLike | null
    let index = 0
    while (hook && prevHook) {
      if (!Object.is(hook.memoizedState, prevHook.memoizedState)) changes.push(`hook:${index}`)
      hook = hook.next
      prevHook = prevHook.next
      index += 1
    }
  }
  let dependency = fiber.dependencies?.firstContext ?? null
  let prevDependency = previous.dependencies?.firstContext ?? null
  while (dependency && prevDependency) {
    if (!Object.is(dependency.memoizedValue, prevDependency.memoizedValue)) {
      const context = dependency.context as { displayName?: string }
      changes.push(`context:${context.displayName ?? 'Context'}`)
    }
    dependency = dependency.next
    prevDependency = prevDependency.next
  }
  return changes
}

type HookLike = { memoizedState: unknown; next: HookLike | null }

// A render whose subtree produced no host mutation changed nothing on screen.
function touchesDom(fiber: Fiber) {
  return ((fiber.flags | fiber.subtreeFlags) & MutationMask) !== 0
}

function report() {
  return [...tallies.entries()].map(([component, tally]) => ({
    changes: [...tally.changes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}×${count}`),
    component,
    noDomChange: tally.noDomChange,
    parentDriven: tally.parentDriven,
    renders: tally.renders,
    timeMs: Math.round(tally.timeMs * 10) / 10,
  }))
}

function reset() {
  tallies.clear()
}

Object.assign(globalThis, { __agentRenders: { report, reset } })
