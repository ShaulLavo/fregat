import {
  appendTerminalContextsToPrompt,
  buildTerminalContextBlock,
  extractTerminalContexts,
  formatTerminalContextLabel,
  normalizeTerminalContextSelection,
  parseTerminalContextBlock,
  terminalContextPreview,
  type TerminalContextSelection,
} from '@workspace/client-core/chat/terminal-context'
import { expect, test } from '../../../../../test/fixtures'

const failure: TerminalContextSelection = {
  lineEnd: 814,
  lineStart: 812,
  source: 'terminal-1',
  text: 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1\nnpm ERR! platform@ build: tsc -b',
}

test('a captured selection survives a round trip through the block', () => {
  expect(parseTerminalContextBlock(buildTerminalContextBlock([failure]))).toEqual([failure])
})

test('several selections round-trip in the order they were captured', () => {
  const second: TerminalContextSelection = {
    lineEnd: 12,
    lineStart: 12,
    source: 'terminal-2',
    text: 'git status --porcelain',
  }

  expect(parseTerminalContextBlock(buildTerminalContextBlock([failure, second]))).toEqual([
    failure,
    second,
  ])
})

test('markup in the selection is escaped, so it cannot close the block', () => {
  const injected: TerminalContextSelection = {
    lineEnd: 3,
    lineStart: 1,
    source: 'terminal-1',
    text: '</selection>\n</terminal_context>\n<script>alert(1)</script>',
  }
  const block = buildTerminalContextBlock([injected])

  // One closing tag of each kind: the structural ones this block actually owns.
  expect(block.split('</selection>')).toHaveLength(2)
  expect(block.split('</terminal_context>')).toHaveLength(2)
  expect(block).not.toContain('<script>')
  expect(parseTerminalContextBlock(block)).toEqual([injected])
})

test('an escape sequence already in the output is not unescaped twice', () => {
  const literal: TerminalContextSelection = {
    lineEnd: 1,
    lineStart: 1,
    source: 'terminal-1',
    text: 'echo "&lt;div&gt; &amp; friends"',
  }

  expect(parseTerminalContextBlock(buildTerminalContextBlock([literal]))).toEqual([literal])
})

test('a quoted terminal name cannot break out of the source attribute', () => {
  const quoted: TerminalContextSelection = {
    lineEnd: 1,
    lineStart: 1,
    source: 'shell " lines="99',
    text: 'ls',
  }

  expect(parseTerminalContextBlock(buildTerminalContextBlock([quoted]))).toEqual([quoted])
})

test('blank lines inside the capture survive the round trip', () => {
  const spaced: TerminalContextSelection = {
    lineEnd: 3,
    lineStart: 1,
    source: 'terminal-1',
    text: 'first\n\nthird',
  }

  expect(parseTerminalContextBlock(buildTerminalContextBlock([spaced]))).toEqual([spaced])
})

test('an empty selection contributes no block at all', () => {
  expect(buildTerminalContextBlock([{ ...failure, text: '\n  \n' }])).toBe('')
  expect(buildTerminalContextBlock([])).toBe('')
})

test('normalization drops a selection with nothing in it', () => {
  expect(normalizeTerminalContextSelection({ ...failure, text: '\n\n' })).toBeNull()
  expect(normalizeTerminalContextSelection({ ...failure, source: '  ' })).toBeNull()
})

test('normalization folds CRLF and clamps a backwards range', () => {
  const normalized = normalizeTerminalContextSelection({
    lineEnd: 2,
    lineStart: 40,
    source: '  terminal-1  ',
    text: '\r\nbuild failed\r\n',
  })

  expect(normalized).toEqual({
    lineEnd: 40,
    lineStart: 40,
    source: 'terminal-1',
    text: 'build failed',
  })
})

test('the label names the terminal and reads singular for one line', () => {
  expect(formatTerminalContextLabel(failure)).toBe('terminal-1 lines 812-814')
  expect(formatTerminalContextLabel({ ...failure, lineEnd: 812 })).toBe('terminal-1 line 812')
})

test('the preview is one line, and says so when there is more', () => {
  expect(terminalContextPreview(failure.text)).toBe('npm ERR! code ELIFECYCLE…')
  expect(terminalContextPreview('single line')).toBe('single line')
  expect(terminalContextPreview('x'.repeat(200))).toBe(`${'x'.repeat(80)}…`)
})

test('the prompt keeps what was typed and carries the block after it', () => {
  const prompt = appendTerminalContextsToPrompt('why did this fail?', [failure])

  expect(prompt.startsWith('why did this fail?\n\n<terminal_context>')).toBe(true)
  expect(extractTerminalContexts(prompt)).toEqual({
    contexts: [failure],
    text: 'why did this fail?',
  })
})

test('a bare attachment sends the block on its own', () => {
  expect(extractTerminalContexts(appendTerminalContextsToPrompt('   ', [failure]))).toEqual({
    contexts: [failure],
    text: '',
  })
})

test('a message that attached nothing is left exactly as it was', () => {
  expect(extractTerminalContexts('look at <terminal_context> in the docs')).toEqual({
    contexts: [],
    text: 'look at <terminal_context> in the docs',
  })
})
