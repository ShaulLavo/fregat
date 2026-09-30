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
function deferredHighlighter(themeKey = 'test') {
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
    themeKey,
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

function render_(highlighter: CodeHighlighter | null, code: string, language: string) {
  return (
    <CodeHighlighterContext value={highlighter}>
      <HighlightedCode code={code} incomplete language={language} />
    </CodeHighlighterContext>
  )
}

test('removing the highlighter removes the colours it painted', () => {
  const { highlighter, flush } = deferredHighlighter()
  const { container, rerender } = render(render_(highlighter, 'const a = 1\nx', 'ts'))
  act(flush)
  expect(colouredSpans(container)).toBe(1)

  rerender(render_(null, 'const a = 1\nx', 'ts'))
  expect(colouredSpans(container)).toBe(0)
  expect(container.textContent).toBe('const a = 1\nx')
})

test('another language or theme never shows the previous answer for a shared prefix', () => {
  const first = deferredHighlighter('first')
  const { container, rerender } = render(render_(first.highlighter, 'const a = 1\nx', 'ts'))
  act(first.flush)
  expect(colouredSpans(container)).toBe(1)

  rerender(render_(first.highlighter, 'const a = 1\nconst b\nx', 'python'))
  expect(colouredSpans(container)).toBe(0)

  const second = deferredHighlighter('second')
  rerender(render_(second.highlighter, 'const a = 1\nconst b\nx', 'python'))
  expect(colouredSpans(container)).toBe(0)
  act(second.flush)
  expect(colouredSpans(container)).toBe(1)
})
