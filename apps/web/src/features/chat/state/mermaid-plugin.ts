import type { DiagramPlugin } from '@streamdown/mermaid'

import { log } from '@/lib/client-logging'

type MermaidPluginLoader = () => Promise<{ readonly mermaid: DiagramPlugin }>

// Mermaid is the heaviest thing a chat can render and most chats never render
// it, so the plugin (and the library behind it) stays out of the boot path
// until the first mermaid fence settles.
const defaultLoader: MermaidPluginLoader = () => import('@streamdown/mermaid')

let loader = defaultLoader
let loaded: DiagramPlugin | null = null
let pending: Promise<DiagramPlugin | null> | null = null

export function loadedMermaidPlugin(): DiagramPlugin | null {
  return loaded
}

export function loadMermaidPlugin(): Promise<DiagramPlugin | null> {
  if (pending) return pending

  const startedAt = performance.now()
  pending = loader().then(
    (module) => {
      loaded = module.mermaid
      log.info({
        action: 'chat.mermaid.load',
        area: 'chat',
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'loaded',
      })
      return loaded
    },
    (error: unknown) => {
      // The fence stays a code block for the rest of the session; one event
      // says why, not one per render.
      log.warn({
        action: 'chat.mermaid.load',
        area: 'chat',
        durationMs: Math.round(performance.now() - startedAt),
        error,
        outcome: 'failed',
      })
      return null
    },
  )
  return pending
}

/** Test seam: swap the dynamic import for a loader that fails or resolves on cue. */
export function setMermaidPluginLoader(next: MermaidPluginLoader | null): void {
  loader = next ?? defaultLoader
  loaded = null
  pending = null
}
