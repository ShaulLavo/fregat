import type { EditorSyntaxSessionFactory, HighlightRegistry } from './types'

type EditorMountTimingObserver = (durationMs: number) => void

let editorInstanceCount = 0
let editorSyntaxSessionFactory: EditorSyntaxSessionFactory | undefined
let highlightRegistry: HighlightRegistry | undefined
const editorMountTimingObservers = new Set<EditorMountTimingObserver>()

export function nextEditorHighlightPrefix(): string {
  return `editor-token-${editorInstanceCount++}`
}

export function resetEditorInstanceCount(): void {
  editorInstanceCount = 0
}

export function observeEditorMountTiming(observer: EditorMountTimingObserver): () => void {
  editorMountTimingObservers.add(observer)

  return () => {
    editorMountTimingObservers.delete(observer)
  }
}

export function recordEditorMountTiming(durationMs: number): void {
  if (editorMountTimingObservers.size === 0) return

  for (const observer of editorMountTimingObservers) observer(durationMs)
}

/**
 * Override the HighlightRegistry used by all Editor instances.
 * Useful for testing environments where CSS.highlights is unavailable.
 * Pass `undefined` to revert to the default `CSS.highlights`.
 */
export function setHighlightRegistry(registry: HighlightRegistry | undefined): void {
  highlightRegistry = registry
}

export function getHighlightRegistry(): HighlightRegistry | undefined {
  return highlightRegistry ?? globalThis.CSS?.highlights
}

export function setEditorSyntaxSessionFactory(
  factory: EditorSyntaxSessionFactory | undefined,
): void {
  editorSyntaxSessionFactory = factory
}

export function getEditorSyntaxSessionFactory(): EditorSyntaxSessionFactory | undefined {
  return editorSyntaxSessionFactory
}
