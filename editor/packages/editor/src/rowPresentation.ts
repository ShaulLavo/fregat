export type EditorRowPresentation = {
  readonly element: HTMLElement
  /** Aborts before logical row text replacement, recycling, provisional paint, or view disposal. */
  readonly signal: AbortSignal
  /** Releases this handle without aborting its signal. Safe to call more than once. */
  dispose(): void
}

const invalidatedRows = new WeakSet<HTMLElement>()
const presentations = new WeakMap<HTMLElement, Set<AbortController>>()

export function acquireRowPresentation(element: HTMLElement): EditorRowPresentation | null {
  if (invalidatedRows.has(element)) return null
  const controller = new AbortController()
  const handles = presentations.get(element) ?? new Set<AbortController>()
  handles.add(controller)
  presentations.set(element, handles)
  return {
    element,
    signal: controller.signal,
    dispose() {
      handles.delete(controller)
      if (handles.size === 0 && presentations.get(element) === handles)
        presentations.delete(element)
    },
  }
}

export function invalidateRowPresentations(element: HTMLElement): void {
  invalidatedRows.add(element)
  const handles = presentations.get(element)
  if (!handles) return
  presentations.delete(element)
  for (const controller of handles) controller.abort()
}

export function completeRowPresentation(element: HTMLElement): void {
  invalidatedRows.delete(element)
}
