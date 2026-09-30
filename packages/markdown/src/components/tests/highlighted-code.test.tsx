import type { HighlightResult } from '@singapore-editor/highlighting'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import {
  CodeHighlighterContext,
  type CodeHighlighter,
} from '../../providers/code-highlighter-context'
import { HighlightedCode } from '../highlighted-code'

afterEach(cleanup)

// Answers only when the test says so, like a worker reply.
function deferredHighlighter() {
  const pending: (() => void)[] = []
  const highlighter: CodeHighlighter = {
    dispose: () => undefined,
    highlight({ code }, onResult) {
      const result: HighlightResult = {
        language: 'typescript',
        themeRevision: 'r',
        foreground: '#fff',
        background: '#000',
        tokens: code.length > 0 ? [{ start: 0, end: 5, style: { color: '#f00' } }] : [],
      }
      pending.push(() => onResult(result))
      return null
    },
    themeKey: 'test',
  }
  return { highlighter, flush: () => pending.splice(0).forEach((reply) => reply()) }
}

function colouredSpans(container: HTMLElement) {
  return container.querySelectorAll('span[style*="color"]').length
}

test('a streamed fence keeps its colours while the longer prefix is being highlighted', () => {
  const { highlighter, flush } = deferredHighlighter()
  const view = (code: string) => (
    <CodeHighlighterContext value={highlighter}>
      <HighlightedCode code={code} incomplete language='ts' />
    </CodeHighlighterContext>
  )
  const { container, rerender } = render(view('const a = 1\nconst'))
  expect(colouredSpans(container)).toBe(0)
  act(flush)
  expect(colouredSpans(container)).toBe(1)

  rerender(view('const a = 1\nconst b = 2\nx'))
  expect(colouredSpans(container)).toBe(1)
  expect(container.textContent).toBe('const a = 1\nconst b = 2\nx')
  act(flush)
  expect(colouredSpans(container)).toBe(1)
})
