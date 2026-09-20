import type { FilesystemPath } from '@/lib/documents/utils/types'
export function markEditorOpenBenchmark(name: string, path: FilesystemPath): void {
  const traceGlobal = globalThis as typeof globalThis & { readonly __editorPerfTrace?: unknown }
  if (!traceGlobal.__editorPerfTrace) return

  globalThis.performance?.mark(name, { detail: { path } })
}
