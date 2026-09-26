import { useQuery } from '@tanstack/react-query'
import { HighlightedCode } from '@workspace/markdown/components/highlighted-code'
import { CodeHighlighterContext } from '@workspace/markdown/providers/code-highlighter-context'

import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { useCodeHighlighter } from '@/lib/code-highlight/hooks/use-code-highlighter'
import { useSettingValue } from '@/hooks/use-setting-value'
import type { ReactNode } from 'react'
import { formatSize } from '@/lib/path-formatters'
import { lineNumbers, previewExtension } from '@/lib/file-preview/utils/preview'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'

/**
 * The head of a file in the code theme's colours, up to the preview budget. It scrolls both ways,
 * so no line is clipped, and numbers its lines so a scrolled view says where it is.
 */
export function TextPreview({
  fallback,
  name,
  path,
}: {
  /** Shown for binary files, and beside a failed read. */
  fallback: ReactNode
  name: string
  path: string
}) {
  const maxBytes = useSettingValue('files.previewKilobytes') * 1024
  const query = useQuery(previewQueryOptions(path, maxBytes))
  const highlighter = useCodeHighlighter()

  if (query.isError)
    return (
      <div className='flex flex-col items-center gap-2'>
        {fallback}
        <p className='text-muted-foreground text-2xs text-center' role='status'>
          {clientErrorDescription(toClientError(query.error))}
        </p>
      </div>
    )
  if (!query.data || query.data.kind === 'binary') return fallback
  const { size, text, truncated } = query.data

  return (
    <div
      className='bg-content-well min-h-0 w-full min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-md text-left'
      data-file-preview-scroll=''
    >
      <div className='flex min-w-0'>
        <pre
          aria-hidden='true'
          className='text-muted-foreground text-2xs/relaxed shrink-0 py-2 pr-3 pl-2 text-right font-mono tabular-nums select-none'
        >
          {lineNumbers(text)}
        </pre>
        <div className='min-w-0 flex-1 overflow-x-auto' data-file-preview-lines=''>
          <CodeHighlighterContext value={highlighter}>
            <HighlightedCode
              className='text-2xs/relaxed w-max min-w-full py-2 pr-2 whitespace-pre'
              code={text}
              incomplete={false}
              data-file-preview-text=''
              language={previewExtension(name)}
            />
          </CodeHighlighterContext>
        </div>
      </div>
      {truncated ? (
        <p className='text-muted-foreground text-2xs px-2 pb-2' role='note'>
          {`First ${formatSize(maxBytes)} of ${formatSize(size)}`}
        </p>
      ) : null}
    </div>
  )
}
