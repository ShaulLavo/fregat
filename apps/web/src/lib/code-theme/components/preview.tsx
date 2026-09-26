import { LoadingState } from '@workspace/ui/components/loading-state'
import { cn } from '@workspace/ui/lib/utils'

import { useCodeThemePreview } from '@/lib/code-theme/hooks/use-preview'
import { editorThemeColorMode } from '@/lib/code-theme/utils/catalog'
import { previewTokenStyle } from '@/lib/code-theme/utils/preview'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'

export function CodeThemePreview({
  themeId,
  className,
}: {
  readonly themeId: string
  readonly className?: string
}) {
  const preview = useCodeThemePreview(themeId)
  const colorMode = editorThemeColorMode(themeId)

  return (
    <div
      aria-label={colorMode === 'light' ? 'Light code theme preview' : 'Dark code theme preview'}
      className={cn('bg-card-solid min-w-0 overflow-hidden', className)}
      data-code-theme-preview={themeId}
      role='region'
    >
      {preview.kind === 'loading' && (
        <LoadingState className='flex h-51 flex-col gap-2.5 p-4' label='Loading code theme preview'>
          <div className='skeleton-sweep h-2.5 w-3/5 rounded-md' />
          <div className='skeleton-sweep h-2.5 w-4/5 rounded-md' />
          <div className='skeleton-sweep mt-2 h-2.5 w-3/4 rounded-md' />
          <div className='skeleton-sweep h-2.5 w-1/2 rounded-md' />
          <div className='skeleton-sweep h-2.5 w-2/3 rounded-md' />
        </LoadingState>
      )}
      {preview.kind === 'error' && (
        <div
          className='text-muted-foreground flex h-51 flex-col items-center justify-center gap-(--density-gap-tight) p-4 text-xs'
          role='alert'
        >
          <p>Could not load this code theme preview.</p>
          <FixWithAgentButton
            error={{
              message: 'Could not load this code theme preview.',
              title: 'Code theme preview',
            }}
          />
        </div>
      )}
      {preview.kind === 'ready' && (
        <pre
          className={cn(
            'overflow-x-auto py-3 font-mono text-xs leading-5',
            colorMode === 'light' ? 'bg-card-light-solid' : 'bg-card-dark-solid',
          )}
          data-theme-id={themeId}
          style={{ color: preview.result.fg }}
        >
          <code>
            {preview.result.tokens.map((line, lineIndex) => (
              <span className='flex min-w-max pr-4' key={lineIndex}>
                <span
                  aria-hidden='true'
                  className='text-muted-foreground text-2xs w-10 shrink-0 pr-3 text-right font-mono tabular-nums select-none'
                >
                  {lineIndex + 1}
                </span>
                <span>
                  {line.map((token) => (
                    <span key={token.offset} style={previewTokenStyle(token)}>
                      {token.content}
                    </span>
                  ))}
                  {line.length === 0 ? '\u00a0' : null}
                </span>
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  )
}
