import { cn } from '@workspace/ui/lib/utils'

export function HighlightedPreview({
  active,
  preview,
  query,
  range,
  replacementText,
}: {
  active?: boolean
  preview: string
  query: string
  range?: { end: number; start: number } | null
  replacementText?: string
}) {
  const highlight = range ? previewRangeHighlight(preview, range) : previewHighlight(preview, query)
  if (!highlight) {
    return (
      <span className='block max-w-full overflow-hidden text-ellipsis whitespace-nowrap'>
        {preview}
      </span>
    )
  }

  if (replacementText !== undefined) {
    return (
      <span className='block max-w-full overflow-hidden text-ellipsis whitespace-nowrap'>
        {highlight.before}
        <mark className='bg-diff-removed/15 text-diff-removed decoration-diff-removed/70 inline-block max-w-full overflow-hidden rounded-md px-0.5 align-bottom text-ellipsis whitespace-nowrap line-through'>
          {highlight.match}
        </mark>
        <mark className='bg-diff-added/15 text-diff-added ml-0.5 inline-block max-w-full overflow-hidden rounded-md px-0.5 align-bottom text-ellipsis whitespace-nowrap'>
          {replacementText}
        </mark>
        {highlight.after}
      </span>
    )
  }

  return (
    <span className='block max-w-full overflow-hidden text-ellipsis whitespace-nowrap'>
      {highlight.before}
      <mark
        className={cn(
          'text-foreground inline-block max-w-full overflow-hidden rounded-md px-0.5 align-bottom text-ellipsis whitespace-nowrap',
          // Same tokens the editor-backed result tabs paint with, so a match
          // looks the same in the sidebar and in a result tab — including the
          // forced-colors mapping, where every background collapses to the
          // system Highlight color and only the underline separates the active
          // match from the rest.
          active
            ? 'bg-search-match-active decoration-search-match-active-decoration underline decoration-2 underline-offset-2'
            : 'bg-search-match',
        )}
      >
        {highlight.match}
      </mark>
      {highlight.after}
    </span>
  )
}

function previewRangeHighlight(preview: string, range: { end: number; start: number }) {
  if (range.start < 0 || range.end <= range.start) return null
  if (range.start >= preview.length) return null

  const end = Math.min(range.end, preview.length)
  return {
    after: preview.slice(end),
    before: preview.slice(0, range.start),
    match: preview.slice(range.start, end),
  }
}

function previewHighlight(preview: string, query: string) {
  if (!query) return null

  const normalizedPreview = preview.toLocaleLowerCase()
  const normalizedQuery = query.toLocaleLowerCase()
  const index = normalizedPreview.indexOf(normalizedQuery)
  if (index < 0) return null

  const end = index + query.length
  return {
    after: preview.slice(end),
    before: preview.slice(0, index),
    match: preview.slice(index, end),
  }
}
