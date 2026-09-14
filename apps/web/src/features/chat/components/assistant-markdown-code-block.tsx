import { ArrowUDownLeftIcon } from '@phosphor-icons/react'
import { HighlightedCode } from '@workspace/markdown/components/highlighted-code'
import type { MarkdownCodeBlockProps } from '@workspace/markdown/providers/render-context'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { use, useState } from 'react'

import { fileIconStyle } from '@/lib/file-icon-style'
import { iconForEntry } from '@/lib/file-icons'

import { MarkdownDiagramContext } from '@/features/chat/providers/markdown-diagram-context'
import { fenceIconFileName, fenceTitle } from '@/features/chat/utils/markdown-fence'
import { AssistantMarkdownMermaid } from './assistant-markdown-mermaid'
import { MarkdownCopyButton } from './markdown-copy-button'
import { MarkdownRenderErrorBoundary } from './markdown-render-error-boundary'

const BODY_CLASS_NAME = 'overflow-x-auto bg-transparent p-2 text-xs leading-5'

/**
 * Every fence in a chat message. A settled mermaid fence becomes a diagram once
 * the library is in; everything else, and mermaid until then, is highlighted
 * through the shared cache.
 */
export function AssistantMarkdownCodeBlock({
  code,
  incomplete,
  language,
  meta,
}: MarkdownCodeBlockProps) {
  const mermaid = use(MarkdownDiagramContext)
  const [wrapped, setWrapped] = useState(false)
  const text = trimTrailingNewlines(code)
  if (language === 'mermaid' && mermaid && !incomplete) {
    return <AssistantMarkdownMermaid chart={text} mermaid={mermaid} />
  }

  const title = fenceTitle(meta)
  const icon = iconForEntry({ name: fenceIconFileName(title, language), type: 'file' })
  const wrapLabel = wrapped ? 'Stop wrapping lines' : 'Wrap lines'

  return (
    <div
      className='my-4 flex w-full min-w-0 flex-col gap-2 rounded-lg p-2 data-[wrap=true]:[&_pre]:break-words data-[wrap=true]:[&_pre]:whitespace-pre-wrap'
      data-incomplete={incomplete || undefined}
      data-language={language}
      data-markdown='code-block'
      data-wrap={wrapped ? 'true' : 'false'}
    >
      <div
        className='text-muted-foreground flex h-8 items-center justify-between gap-2 text-xs select-none'
        data-language={language}
        data-markdown='code-block-header'
      >
        {/* Not on the header: the toolbar beside it holds Tooltip controls (D4). */}
        <span className='flex min-w-0 items-center gap-1.5 pl-1' title={title ?? undefined}>
          <span aria-hidden='true' className='size-3.5 shrink-0' style={fileIconStyle(icon)} />
          <span className={title ? 'truncate font-mono' : 'truncate font-mono lowercase'}>
            {title ?? language}
          </span>
        </span>
        <span aria-label='Code block actions' className='flex items-center gap-0.5' role='toolbar'>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={wrapLabel}
                  aria-pressed={wrapped}
                  data-chat-code-wrap-toggle='true'
                  size='icon-xs'
                  type='button'
                  variant='ghost'
                  onClick={() => setWrapped(!wrapped)}
                />
              }
            >
              <ArrowUDownLeftIcon className='size-3' />
            </TooltipTrigger>
            <TooltipContent>{wrapLabel}</TooltipContent>
          </Tooltip>
          <MarkdownCopyButton label='Copy code' text={text} />
        </span>
      </div>
      <MarkdownRenderErrorBoundary
        fallback={
          <pre className={BODY_CLASS_NAME} data-markdown='code-block-body'>
            <code className='font-mono'>{text}</code>
          </pre>
        }
        language={language}
      >
        <HighlightedCode
          className={BODY_CLASS_NAME}
          code={text}
          data-markdown='code-block-body'
          incomplete={incomplete}
          language={language}
        />
      </MarkdownRenderErrorBoundary>
    </div>
  )
}

function trimTrailingNewlines(value: string) {
  return value.replace(/\n+$/u, '')
}
