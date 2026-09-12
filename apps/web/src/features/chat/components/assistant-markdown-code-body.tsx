import type { HighlightResult } from '@streamdown/code'
import type { CSSProperties } from 'react'

import { useHighlightedCode } from '@/features/chat/hooks/use-highlighted-code'
import { completedCodePrefix } from '@/features/chat/utils/markdown-highlight'

type HighlightToken = HighlightResult['tokens'][number][number]

const TOKEN_CLASS_NAME =
  'text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]'

/**
 * Streamdown's own body highlights streamed code too, but it also keeps every
 * intermediate buffer in an unbounded module cache. This renders the same token
 * markup through the chat's byte-bounded cache instead.
 */
export function AssistantMarkdownCodeBody({
  code,
  incomplete,
  language,
}: {
  readonly code: string
  readonly incomplete: boolean
  readonly language: string
}) {
  const prefix = incomplete ? completedCodePrefix(code) : { highlightable: code, trailing: '' }
  const highlighted = useHighlightedCode({
    cacheable: !incomplete,
    code: prefix.highlightable,
    language,
  })

  return (
    <pre
      className='overflow-x-auto bg-transparent p-2 text-xs leading-5'
      data-streamdown='code-block-body'
    >
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

function renderTokenLines(highlighted: HighlightResult) {
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
function tokenStyle(token: HighlightToken): CSSProperties {
  const style: Record<string, string> = {}
  if (token.color) style['--sdm-c'] = token.color

  for (const [property, value] of Object.entries(token.htmlStyle ?? {})) {
    if (value === undefined) continue
    if (property === 'color') {
      style['--sdm-c'] = value
      continue
    }
    style[property] = value
  }

  return style as CSSProperties
}
