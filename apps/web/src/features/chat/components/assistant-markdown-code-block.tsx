import { ArrowUDownLeftIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'
import { CodeBlockCopyButton } from 'streamdown'

import { fileIconStyle } from '@/lib/file-icon-style'
import { iconForEntry } from '@/lib/file-icons'

import { fenceIconFileName, fenceTitle } from '@/features/chat/utils/markdown-fence'
import { AssistantMarkdownCodeBody } from './assistant-markdown-code-body'
import { MarkdownRenderErrorBoundary } from './markdown-render-error-boundary'

/**
 * Registered as a Streamdown custom renderer for every highlightable language,
 * which hands us the raw fence text plus whether it is still streaming — the one
 * signal Streamdown's own code component never exposes to a `components` override.
 */
export function AssistantMarkdownCodeBlock({
  code,
  isIncomplete = false,
  language,
  meta,
}: {
  readonly code: string
  readonly isIncomplete?: boolean
  readonly language: string
  /** Everything after the language on the fence line, e.g. `title="src/foo.ts"`. */
  readonly meta?: string
}) {
  const [wrapped, setWrapped] = useState(false)
  const text = trimTrailingNewlines(code)
  const title = fenceTitle(meta)
  const icon = iconForEntry({ name: fenceIconFileName(title, language), type: 'file' })
  const wrapLabel = wrapped ? 'Stop wrapping lines' : 'Wrap lines'

  return (
    <div
      className='border-border bg-card my-4 flex w-full min-w-0 flex-col gap-2 rounded-lg border p-2 data-[wrap=true]:[&_pre]:break-words data-[wrap=true]:[&_pre]:whitespace-pre-wrap'
      data-incomplete={isIncomplete || undefined}
      data-language={language}
      data-streamdown='code-block'
      data-wrap={wrapped ? 'true' : 'false'}
    >
      <div
        className='text-muted-foreground flex h-8 items-center justify-between gap-2 text-xs select-none'
        data-language={language}
        data-streamdown='code-block-header'
      >
        <span className='flex min-w-0 items-center gap-1.5 pl-1'>
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
          <CodeBlockCopyButton code={text} />
        </span>
      </div>
      <MarkdownRenderErrorBoundary
        fallback={
          <pre
            className='overflow-x-auto bg-transparent p-2 text-xs leading-5'
            data-streamdown='code-block-body'
          >
            <code className='font-mono'>{text}</code>
          </pre>
        }
        language={language}
      >
        <AssistantMarkdownCodeBody code={text} incomplete={isIncomplete} language={language} />
      </MarkdownRenderErrorBoundary>
    </div>
  )
}

function trimTrailingNewlines(value: string) {
  return value.replace(/\n+$/u, '')
}
