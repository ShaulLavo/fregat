import { queryOptions } from '@tanstack/react-query'
import { log } from '@/lib/client-logging'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { runMutation } from '@/lib/mutations/run'
import { mermaidQueryKeys } from '@/features/chat/utils/query-keys'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import type mermaid from 'mermaid'
import { withIsolatedDiagramClasses } from '@/features/chat/state/diagram-parser'
import { diagramFontLoaded } from '@/features/chat/state/diagram-font'
import type { MermaidTheme } from '@/features/chat/utils/diagram-theme'

export type MermaidRenderer = {
  readonly render: (chart: string, theme: MermaidTheme) => Promise<string>
}

type MermaidModule = {
  mermaidAPI: {
    getDiagramFromText(
      chart: string,
    ): Promise<Pick<Awaited<ReturnType<typeof mermaid.mermaidAPI.getDiagramFromText>>, 'parser'>>
  }
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
    render(chart, theme) {
      return runMutation(
        resourceQueryClient,
        {
          mutationKey: chatMutationKeys.mermaidRender,
          // Mermaid shares its configuration and render queue across all diagrams.
          scope: { id: 'mermaid-render' },
          networkMode: 'always',
          retry: false,
          mutationFn: () => renderDiagram(mermaid, chart, theme),
        },
        undefined,
      )
    },
  }
}

async function renderDiagram(mermaid: MermaidModule, chart: string, theme: MermaidTheme) {
  const startedAt = performance.now()
  const candidate = chart.trim().split(/[\s;]/, 1)[0] ?? ''
  const diagramType =
    /^(?:graph|flowchart|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|kanban|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)$/.test(
      candidate,
    )
      ? candidate
      : 'unknown'
  const font = await diagramFontLoaded(theme.fontFamily, chart)
  try {
    mermaid.initialize({
      fontFamily: theme.fontFamily,
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: { ...theme.variables, darkMode: theme.colorMode === 'dark' },
    })
    nextDiagramId += 1
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
    const { svg } = await withIsolatedDiagramClasses(diagram.parser, () =>
      mermaid.render(`chat-mermaid-${nextDiagramId}`, chart),
    )
    log.info({
      action: 'chat.mermaid.render',
      area: 'chat',
      durationMs: Math.round(performance.now() - startedAt),
      diagramType,
      font,
      outcome: 'rendered',
    })
    return svg
  } catch (error) {
    log.warn({
      action: 'chat.mermaid.render',
      area: 'chat',
      durationMs: Math.round(performance.now() - startedAt),
      diagramType,
      font,
      outcome: 'failed',
      failure: error instanceof Error ? 'renderer-error' : 'unknown-error',
    })
    throw error
  }
}
