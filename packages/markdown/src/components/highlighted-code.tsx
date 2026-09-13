import type { ComponentProps, CSSProperties } from 'react'
import type { ThemedToken, TokensResult } from 'shiki/core'

import { useHighlightedCode } from '../hooks/use-highlighted-code'
import { completedCodePrefix } from '../utils/highlight'

type HighlightedCodeProps = Omit<ComponentProps<'pre'>, 'children'> & {
  readonly code: string
  /** Still streaming: the last line is left plain and nothing is cached. */
  readonly incomplete: boolean
  readonly language: string
}

const TOKEN_CLASS_NAME =
  'text-[var(--code-token-color,inherit)] dark:text-[var(--shiki-dark,var(--code-token-color,inherit))]'

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
        {highlighted ? renderTokenLines(highlighted) : prefix.highlightable}
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

function renderTokenLines(highlighted: TokensResult) {
  const lastLineIndex = highlighted.tokens.length - 1

  return highlighted.tokens.map((line, lineIndex) => (
    <span key={`line-${lineIndex}`}>
      {line.map((token, tokenIndex) => (
        <span className={TOKEN_CLASS_NAME} key={`token-${tokenIndex}`} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
      {lineIndex < lastLineIndex ? '\n' : null}
    </span>
  ))
}

/** Colours are values shiki computes at runtime, so they can only be inline styles. */
function tokenStyle(token: ThemedToken): CSSProperties {
  const style: Record<string, string> = {}
  if (token.color) style['--code-token-color'] = token.color

  for (const [property, value] of Object.entries(token.htmlStyle ?? {})) {
    if (value === undefined) continue
    if (property === 'color') {
      style['--code-token-color'] = value
      continue
    }
    style[property] = value
  }

  return style as CSSProperties
}
