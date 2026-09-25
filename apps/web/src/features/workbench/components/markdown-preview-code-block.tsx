import { HighlightedCode } from '@workspace/markdown/components/highlighted-code'
import type { MarkdownCodeBlockProps } from '@workspace/markdown/providers/render-context'

/** A fence in rendered markdown, tokenized by the editor's theme like the source beside it. */
export function MarkdownPreviewCodeBlock({ code, incomplete, language }: MarkdownCodeBlockProps) {
  return (
    <HighlightedCode
      className='bg-content-well overflow-x-auto rounded-md p-3 font-mono text-xs leading-5'
      code={code}
      incomplete={incomplete}
      language={language}
    />
  )
}
