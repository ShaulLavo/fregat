import { log } from '@/lib/client-logging'

type MermaidColorMode = 'dark' | 'light'

/** Renders one diagram source to SVG markup. */
export type MermaidRenderer = {
  readonly render: (chart: string, colorMode: MermaidColorMode) => Promise<string>
}

type MermaidModule = {
  initialize(config: Record<string, unknown>): void
  render(id: string, text: string): Promise<{ readonly svg: string }>
}

type MermaidLoader = () => Promise<MermaidModule>

// Mermaid is the heaviest thing a chat can render and most chats never render
// it, so the library stays out of the boot path until the first mermaid fence
// settles.
const defaultLoader: MermaidLoader = () => import('mermaid').then((module) => module.default)

let loader = defaultLoader
let loaded: MermaidRenderer | null = null
let pending: Promise<MermaidRenderer | null> | null = null
let nextDiagramId = 0

export function loadedMermaid(): MermaidRenderer | null {
  return loaded
}

export function loadMermaid(): Promise<MermaidRenderer | null> {
  if (pending) return pending

  const startedAt = performance.now()
  pending = loader().then(
    (module) => {
      loaded = createRenderer(module)
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
export function setMermaidLoader(next: MermaidLoader | null): void {
  loader = next ?? defaultLoader
  loaded = null
  pending = null
}

function createRenderer(mermaid: MermaidModule): MermaidRenderer {
  return {
    async render(chart, colorMode) {
      mermaid.initialize({
        fontFamily: 'inherit',
        securityLevel: 'strict',
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: colorMode === 'dark' ? 'dark' : 'default',
      })
      nextDiagramId += 1
      const { svg } = await mermaid.render(`chat-mermaid-${nextDiagramId}`, chart)

      return svg
    },
  }
}
