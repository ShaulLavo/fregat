import { useEffect, useState } from 'react'

import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import type { MermaidRenderer } from '@/features/chat/state/mermaid'
import { log } from '@/lib/client-logging'
import { MarkdownCopyButton } from './markdown-copy-button'

type DiagramState = {
  readonly chart: string
  readonly error: string | null
  readonly svg: string | null
}

/**
 * A settled mermaid fence as a diagram. The source stays visible until the
 * SVG is in, and stays as the fallback when the graph does not parse.
 */
export function AssistantMarkdownMermaid({
  chart,
  mermaid,
}: {
  readonly chart: string
  readonly mermaid: MermaidRenderer
}) {
  const { colorMode } = useEditorColorTheme()
  const [state, setState] = useState<DiagramState | null>(null)
  const current = state?.chart === chart ? state : null

  useEffect(() => {
    let cancelled = false
    mermaid.render(chart, colorMode).then(
      (svg) => {
        if (!cancelled) setState({ chart, error: null, svg })
      },
      (error: unknown) => {
        if (cancelled) return

        const message = error instanceof Error ? error.message : String(error)
        log.warn({ action: 'chat.mermaid.render', area: 'chat', error: message, outcome: 'failed' })
        setState({ chart, error: message, svg: null })
      },
    )
    return () => {
      cancelled = true
    }
  }, [chart, colorMode, mermaid])

  return (
    <div
      className='my-4 flex w-full min-w-0 flex-col gap-2 rounded-lg p-2'
      data-language='mermaid'
      data-markdown='mermaid-block'
    >
      <div
        className='text-muted-foreground flex h-8 items-center justify-between gap-2 text-xs select-none'
        data-markdown-copy=''
      >
        <span className='truncate pl-1 font-mono'>mermaid</span>
        <span aria-label='Diagram actions' className='flex items-center gap-0.5' role='toolbar'>
          <MarkdownCopyButton label='Copy diagram source' text={chart} />
        </span>
      </div>
      {current?.svg ? (
        <div
          aria-label='Mermaid diagram'
          className='flex justify-center overflow-x-auto p-2 [&_svg]:max-w-full'
          dangerouslySetInnerHTML={{ __html: current.svg }}
          role='img'
        />
      ) : (
        <pre className='overflow-x-auto bg-transparent p-2 text-xs leading-5'>
          <code className='font-mono'>{chart}</code>
        </pre>
      )}
      {current?.error ? (
        <p className='text-destructive text-2xs px-2 pb-1 font-mono'>{current.error}</p>
      ) : null}
    </div>
  )
}
