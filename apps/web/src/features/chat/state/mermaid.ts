import { queryOptions } from '@tanstack/react-query'
import { log } from '@/lib/client-logging'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { runMutation } from '@/lib/mutations/run'
import { mermaidQueryKeys } from '@/features/chat/utils/query-keys'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'

type MermaidColorMode = 'dark' | 'light'

export type MermaidRenderer = {
  readonly render: (chart: string, colorMode: MermaidColorMode) => Promise<string>
}

type MermaidModule = {
  initialize(config: Record<string, unknown>): void
  render(id: string, text: string): Promise<{ readonly svg: string }>
}

type MermaidLoader = () => Promise<MermaidModule>

const defaultLoader: MermaidLoader = () => import('mermaid').then((module) => module.default)
let loader = defaultLoader
let nextDiagramId = 0

export const mermaidQueryOptions = queryOptions({
  queryKey: mermaidQueryKeys.library,
  queryFn: acquireMermaid,
  staleTime: 'static',
  gcTime: Infinity,
  networkMode: 'always',
  structuralSharing: false,
  retry: false,
  retryOnMount: false,
})

export function loadedMermaid(): MermaidRenderer | null {
  return resourceQueryClient.getQueryData<MermaidRenderer>(mermaidQueryKeys.library) ?? null
}

async function acquireMermaid(): Promise<MermaidRenderer> {
  const startedAt = performance.now()
  try {
    const module = await loader()
    log.info({
      action: 'chat.mermaid.load',
      area: 'chat',
      durationMs: Math.round(performance.now() - startedAt),
      outcome: 'loaded',
    })
    return createRenderer(module)
  } catch (error) {
    log.warn({
      action: 'chat.mermaid.load',
      area: 'chat',
      durationMs: Math.round(performance.now() - startedAt),
      error,
      outcome: 'failed',
    })
    throw error
  }
}

export function setMermaidLoader(next: MermaidLoader | null): void {
  resourceQueryClient.removeQueries({ queryKey: mermaidQueryKeys.library })
  loader = next ?? defaultLoader
}

function createRenderer(mermaid: MermaidModule): MermaidRenderer {
  return {
    render(chart, colorMode) {
      return runMutation(
        resourceQueryClient,
        {
          mutationKey: chatMutationKeys.mermaidRender,
          // Mermaid shares its configuration and render queue across all diagrams.
          scope: { id: 'mermaid-render' },
          networkMode: 'always',
          retry: false,
          mutationFn: () => renderDiagram(mermaid, chart, colorMode),
        },
        undefined,
      )
    },
  }
}

async function renderDiagram(mermaid: MermaidModule, chart: string, colorMode: MermaidColorMode) {
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
}
