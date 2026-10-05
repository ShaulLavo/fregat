export type NativeConflictFiber = {
  return: NativeConflictFiber | null
  child: NativeConflictFiber | null
  sibling: NativeConflictFiber | null
  memoizedProps: Record<string, unknown>
  stateNode?: { current: NativeConflictFiber }
}

type NativeConflictRuntime = {
  readonly documentStore: { getState(): unknown }
  readonly uiStore: { getState(): unknown }
}

export type NativeConflictOwner = {
  readonly element: Element
  readonly ownerDocument: Document
  readonly root: { current: NativeConflictFiber }
  readonly runtime: NativeConflictRuntime
}

// Passed directly to evaluateHandle; every value dependency stays inside this browser function.
export function captureNativeConflictOwner(
  element: Element,
  family: 'filesystem' | 'settings',
): NativeConflictOwner | null {
  let host: Element | null = element
  let fiber: NativeConflictFiber | null = null
  while (host && !fiber) {
    const key = Object.keys(host).find((entry) => entry.startsWith('__reactFiber$'))
    if (key) fiber = Reflect.get(host, key)
    host = host.parentElement
  }
  const isStore = (value: unknown): value is { getState(): unknown } =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'getState' in value &&
      typeof value.getState === 'function',
    )
  const isRuntime = (value: unknown): value is NativeConflictRuntime => {
    if (!value || typeof value !== 'object' || !('documentStore' in value) || !('uiStore' in value))
      return false
    if (!isStore(value.documentStore) || !isStore(value.uiStore)) return false
    if (family === 'filesystem') return 'conflictStore' in value && isStore(value.conflictStore)
    return 'workspaceStore' in value && isStore(value.workspaceStore)
  }
  let runtime: NativeConflictRuntime | null = null
  while (fiber) {
    const candidate = fiber.memoizedProps?.runtime
    if (isRuntime(candidate)) runtime = candidate
    if (!fiber.return) break
    fiber = fiber.return
  }
  if (!runtime || !fiber?.stateNode) return null
  return { element, ownerDocument: element.ownerDocument, root: fiber.stateNode, runtime }
}
