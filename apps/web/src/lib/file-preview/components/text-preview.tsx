import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { HighlightedCode } from '@workspace/markdown/components/highlighted-code'
import { CodeHighlighterContext } from '@workspace/markdown/providers/code-highlighter-context'

import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { useCodeHighlighter } from '@/lib/code-highlight/hooks/use-code-highlighter'
import type { ReactNode } from 'react'
import { previewExtension } from '@/lib/file-preview/utils/preview'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'

/** The first lines of a file in the code theme's colours; the previous file stays while the next loads. */
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
  const query = useQuery({ ...previewQueryOptions(path), placeholderData: keepPreviousData })
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

  return (
    <CodeHighlighterContext value={highlighter}>
      <HighlightedCode
        className='bg-content-well text-2xs/relaxed max-h-full w-full min-w-0 overflow-hidden rounded-md p-2 text-left whitespace-pre'
        code={query.data.text}
        incomplete={false}
        data-file-preview-text=''
        language={previewExtension(name)}
      />
    </CodeHighlighterContext>
  )
}
