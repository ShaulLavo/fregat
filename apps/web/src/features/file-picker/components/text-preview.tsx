import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { HighlightedCode } from '@workspace/markdown/components/highlighted-code'
import { CodeHighlighterContext } from '@workspace/markdown/providers/code-highlighter-context'

import type { FsEntry } from '@/lib/file-system-types'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { useCodeHighlighter } from '@/lib/code-highlight/hooks/use-code-highlighter'
import { EntryPreviewTile } from '@/features/file-picker/components/entry-preview-tile'
import type { FilePickerIconMode } from '@/features/file-picker/utils/model'
import { previewExtension } from '@/features/file-picker/utils/preview'
import { previewQueryOptions } from '@/features/file-picker/utils/preview-query'

/** The first lines of a file in the code theme's colours; the previous file stays while the next loads. */
export function TextPreview({ entry, iconMode }: { entry: FsEntry; iconMode: FilePickerIconMode }) {
  const query = useQuery({ ...previewQueryOptions(entry.path), placeholderData: keepPreviousData })
  const highlighter = useCodeHighlighter()
  const tile = <EntryPreviewTile entry={entry} iconMode={iconMode} selected={false} size='lg' />

  if (query.isError)
    return (
      <div className='flex flex-col items-center gap-2'>
        {tile}
        <p className='text-muted-foreground text-2xs text-center' role='status'>
          {clientErrorDescription(toClientError(query.error))}
        </p>
      </div>
    )
  if (!query.data || query.data.kind === 'binary') return tile

  return (
    <CodeHighlighterContext value={highlighter}>
      <HighlightedCode
        className='bg-content-well text-2xs/relaxed max-h-full w-full min-w-0 overflow-hidden rounded-md p-2 text-left whitespace-pre'
        code={query.data.text}
        incomplete={false}
        data-file-preview-text=''
        language={previewExtension(entry.name)}
      />
    </CodeHighlighterContext>
  )
}
