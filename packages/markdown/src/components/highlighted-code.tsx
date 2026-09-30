import type { ComponentProps } from 'react'
import { highlightLines, type HighlightResult } from '@singapore-editor/highlighting'

import { useHighlightedCode } from '../hooks/use-highlighted-code'
import { completedCodePrefix } from '../utils/highlight'

type HighlightedCodeProps = Omit<ComponentProps<'pre'>, 'children'> & {
  readonly code: string
  /** Still streaming: the last line is left plain and nothing is cached. */
  readonly incomplete: boolean
  readonly language: string
}

/**
 * Token markup for one fence, through the shared byte-bounded cache. The
 * chrome around it — header, actions, borders — belongs to the consumer.
 */
export function HighlightedCode({ code, incomplete, language, ...props }: HighlightedCodeProps) {
  const prefix = incomplete ? completedCodePrefix(code) : { highlightable: code, trailing: '' }
  const highlighted = useHighlightedCode({
    cacheable: !incomplete,
    code: prefix.highlightable,
    language,
  })

  return (
    <pre {...props}>
      <code className='font-mono'>
        {highlighted ? renderTokenLines(prefix.highlightable, highlighted) : prefix.highlightable}
        {trailingText(prefix.highlightable, prefix.trailing)}
      </code>
    </pre>
  )
}

function trailingText(highlightable: string, trailing: string) {
  if (trailing.length === 0) return null
  if (highlightable.length === 0) return trailing

  return `\n${trailing}`
}

// Token colours are theme values computed at runtime, so they can only be inline styles.
function renderTokenLines(code: string, highlighted: HighlightResult) {
  const lines = highlightLines(code, highlighted.tokens)
  const lastLineIndex = lines.length - 1

  return lines.map((line, lineIndex) => (
    <span key={`line-${lineIndex}`}>
      {line.map((segment) => (
        <span key={segment.start} style={segment.style ?? undefined}>
          {segment.text}
        </span>
      ))}
      {lineIndex < lastLineIndex ? '\n' : null}
    </span>
  ))
}
