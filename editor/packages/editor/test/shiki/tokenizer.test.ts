import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHighlighter } from 'shiki'

import { createIncrementalTokenizer as createCoreIncrementalTokenizer } from '../../src/shiki'

type TestTokenizerOptions = {
  lang: string
  theme: string
  code?: string
  highlighter?: import('shiki/core').HighlighterGeneric<string, string>
}

async function createIncrementalTokenizer(options: TestTokenizerOptions) {
  const highlighter =
    options.highlighter ??
    ((await createHighlighter({
      themes: [options.theme],
      langs: [options.lang],
    })) as unknown as import('shiki/core').HighlighterGeneric<string, string>)

  return createCoreIncrementalTokenizer({ ...options, highlighter })
}

function flattenTokens(line: readonly { content: string }[]): string {
  return line.map((token) => token.content).join('')
}

const highlighters: Array<{ dispose: () => void }> = []

afterEach(() => {
  while (highlighters.length > 0) highlighters.pop()?.dispose()
})

describe('IncrementalShikiTokenizer', () => {
  it('creates token snapshots for the initial document', async () => {
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code: 'const answer = 42',
    })

    highlighters.push(highlighter)

    const snapshot = tokenizer.getSnapshot()
    expect(snapshot.lines).toHaveLength(1)
    expect(flattenTokens(snapshot.lines[0]?.tokens ?? [])).toBe('const answer = 42')
  })

  it('takes the append fast-path when new code extends the current document', async () => {
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code: 'const a',
    })

    highlighters.push(highlighter)

    const patch = tokenizer.update('const a = 1\nconst b = 2')

    expect(patch.fromLine).toBe(0)
    expect(patch.toLine).toBe(1)
    expect(patch.lines.map((line) => line.text)).toEqual(['const a = 1', 'const b = 2'])
    expect(tokenizer.getSnapshot().lines.map((line) => line.text)).toEqual([
      'const a = 1',
      'const b = 2',
    ])
  })

  it('retokenizes changed lines until grammar state stabilizes', async () => {
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code: ['const a = 1', '/* open', 'still comment */', 'const b = 2'].join('\n'),
    })

    highlighters.push(highlighter)

    const patch = tokenizer.update(
      ['const a = 1', '// open', 'still comment */', 'const b = 2'].join('\n'),
    )

    expect(patch.fromLine).toBe(1)
    expect(patch.toLine).toBe(3)
    expect(patch.lines.map((line) => line.text)).toEqual(['// open', 'still comment */'])
    expect(tokenizer.getSnapshot().lines[3]?.text).toBe('const b = 2')
  })

  it('applyEdit inserts text in the middle of a line', async () => {
    //                   0123456789...
    const code = 'const a = 1\nconst b = 2'
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Insert "nswer" after "a" on line 0  →  "const answer = 1"
    const patch = tokenizer.applyEdit({ from: 6, to: 7, text: 'answer' })

    expect(patch.fromLine).toBe(0)
    expect(patch.lines[0]?.text).toBe('const answer = 1')
    expect(tokenizer.getSnapshot().lines.map((l) => l.text)).toEqual([
      'const answer = 1',
      'const b = 2',
    ])
  })

  it('applyEdit replaces text across multiple lines', async () => {
    const code = 'line 0\nline 1\nline 2\nline 3'
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Replace "1\nline 2" with "replaced"
    //   "line 0\nline " = 12 chars  →  from = 12
    //   "1\nline 2" = 8 chars       →  to = 12 + 8 = 20
    const patch = tokenizer.applyEdit({ from: 12, to: 20, text: 'replaced' })

    expect(patch.fromLine).toBe(1)
    // Lines 1-2 ("line 1\nline 2", offsets 7-20 plus the separator before line 3) became the
    // one line "line replaced", the same length in this case.
    expect(patch).toMatchObject({ fromOffset: 7, oldEndOffset: 21, newEndOffset: 21 })
    expect(tokenizer.getSnapshot().lines.map((l) => l.text)).toEqual([
      'line 0',
      'line replaced',
      'line 3',
    ])
  })

  it('applyEdit deletes a range', async () => {
    const code = 'abc\ndef\nghi'
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Delete "c\ndef\ng" (7 chars starting at 2) → "abhi"
    const patch = tokenizer.applyEdit({ from: 2, to: 9, text: '' })

    expect(tokenizer.getCode()).toBe('abhi')
    expect(patch.fromLine).toBe(0)
    expect(tokenizer.getSnapshot().lines.map((l) => l.text)).toEqual(['abhi'])
  })

  it('applyEdit inserts a newline', async () => {
    const code = 'const a = 1'
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Insert newline after "const a = 1" → two lines
    const patch = tokenizer.applyEdit({ from: 11, to: 11, text: '\nconst b = 2' })

    expect(tokenizer.getCode()).toBe('const a = 1\nconst b = 2')
    expect(patch.fromLine).toBe(0)
    expect(tokenizer.getSnapshot().lines.map((l) => l.text)).toEqual(['const a = 1', 'const b = 2'])
  })

  it('applyEdit retokenizes suffix lines when grammar state changes', async () => {
    const code = ['const a = 1', '// comment', 'const b = 2'].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Replace "// comment" with "/* comment" → opens a block comment
    // "const a = 1\n" = 12 chars, "// comment" starts at 12, ends at 22
    const patch = tokenizer.applyEdit({ from: 12, to: 22, text: '/* comment' })

    expect(tokenizer.getSnapshot().lines.map((l) => l.text)).toEqual([
      'const a = 1',
      '/* comment',
      'const b = 2',
    ])
    // The patch must include line 2 because the grammar state changed
    expect(patch.fromLine).toBe(1)
    expect(patch.toLine).toBeGreaterThanOrEqual(3)
  })

  it('returns an empty patch when the document does not change', async () => {
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code: 'const answer = 42',
    })

    highlighters.push(highlighter)

    const patch = tokenizer.update('const answer = 42')

    expect(patch).toEqual({
      fromLine: 0,
      toLine: 0,
      lines: [],
      fromOffset: 0,
      oldEndOffset: 0,
      newEndOffset: 0,
    })
  })
})

describe('IncrementalShikiTokenizer batches', () => {
  const lines = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index}`)
  const code = lines.join('\n')
  const lineStart = (row: number) =>
    lines.slice(0, row).reduce((offset, line) => offset + line.length + 1, 0)

  it('applies far-apart edits highest-first without tokenizing the lines between', async () => {
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })
    highlighters.push(highlighter)
    let tokenizedLines = 0
    const grammar = highlighter.getLanguage('typescript')
    const tokenizeLine = grammar.tokenizeLine.bind(grammar)
    grammar.tokenizeLine = (...args) => {
      tokenizedLines += 1
      return tokenizeLine(...args)
    }

    const patches = tokenizer.applyEdits([
      { from: lineStart(2) + 6, to: lineStart(2) + 12, text: 'first' },
      { from: lineStart(197) + 6, to: lineStart(197) + 14, text: 'second' },
    ])

    expect(tokenizedLines).toBeLessThan(10)
    expect(patches.map((patch) => patch.fromLine)).toEqual([197, 2])
    expect(patches.map((patch) => patch.fromOffset)).toEqual([lineStart(197), lineStart(2)])
    // "value197" (8 chars) became "second" (6): the line is two shorter.
    expect(patches[0]!.newEndOffset - patches[0]!.oldEndOffset).toBe(-2)
    const texts = tokenizer.getSnapshot().lines.map((line) => line.text)
    expect(texts[2]).toBe('const first = 2')
    expect(texts[197]).toBe('const second = 197')
    expect(texts).toHaveLength(200)
  })

  it('matches a full retokenization after a batch on one line', async () => {
    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })
    highlighters.push(highlighter)

    tokenizer.applyEdits([
      { from: lineStart(5), to: lineStart(5) + 5, text: 'let' },
      { from: lineStart(5) + 15, to: lineStart(5) + 16, text: '"five"' },
    ])

    const expected = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code: tokenizer.getCode(),
      highlighter,
    })
    expect(tokenizer.getSnapshot().lines[5]?.text).toBe('let value5 = "five"')
    expect(tokenizer.getTokens()).toEqual(expected.tokenizer.getTokens())
  })
})

describe('grammar state stabilization', () => {
  // ── JSX ──────────────────────────────────────────────────────

  it('jsx: edit inside element text does not retokenize past the closing tag', async () => {
    const code = [
      'function App() {',
      '  return (',
      '    <div>',
      '      <span>hello</span>',
      '    </div>',
      '  )',
      '}',
      'const after = true',
    ].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'tsx',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Change "hello" → "world" on line 3
    const patch = tokenizer.update(code.replace('hello', 'world'))

    expect(patch.fromLine).toBe(3)
    // Must stabilize before the trailing `const after = true`
    expect(patch.toLine).toBeLessThanOrEqual(7)
    expect(tokenizer.getSnapshot().lines[3]?.text).toBe('      <span>world</span>')
    expect(tokenizer.getSnapshot().lines[7]?.text).toBe('const after = true')
  })

  it('jsx: opening a JSX expression retokenizes subsequent lines', async () => {
    const code = ['const el = <div>done</div>', 'const after = true'].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'tsx',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Remove closing tag → leaves unclosed JSX, grammar state changes
    const patch = tokenizer.update(['const el = <div>', 'const after = true'].join('\n'))

    // The second line must be retokenized because it's now inside JSX content
    expect(patch.toLine).toBeGreaterThanOrEqual(2)
  })

  it('jsx: nested expressions preserve grammar stack depth', async () => {
    const code = [
      'const el = (',
      '  <div>',
      '    {items.map(i => (',
      '      <span key={i}>{i}</span>',
      '    ))}',
      '  </div>',
      ')',
      'const after = true',
    ].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'tsx',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Edit inside the nested expression: {i} → {i + 1}
    const patch = tokenizer.update(code.replace('{i}</span>', '{i + 1}</span>'))

    expect(patch.fromLine).toBe(3)
    expect(patch.toLine).toBeLessThanOrEqual(7)
    expect(tokenizer.getSnapshot().lines[7]?.text).toBe('const after = true')
  })

  // ── Template literals ────────────────────────────────────────

  it('template literal: edit inside body does not retokenize past closing backtick', async () => {
    const code = ['const s = `', '  line one', '  line two', '`', 'const after = true'].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    const patch = tokenizer.update(code.replace('line one', 'LINE ONE'))

    expect(patch.fromLine).toBe(1)
    // Must not touch `const after = true`
    expect(patch.toLine).toBeLessThanOrEqual(4)
    expect(tokenizer.getSnapshot().lines[4]?.text).toBe('const after = true')
  })

  it('template literal: opening a backtick retokenizes all subsequent lines', async () => {
    const code = ["const s = 'normal'", 'const a = 1', 'const b = 2'].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Replace 'normal' with an unclosed template literal
    const patch = tokenizer.update(
      ['const s = `template ${', 'const a = 1', 'const b = 2'].join('\n'),
    )

    // Everything after line 0 is now inside a template expression
    expect(patch.toLine).toBeGreaterThanOrEqual(3)
  })

  it('template literal: closing a backtick stops retokenization', async () => {
    const code = ['const s = `open', 'still template', 'const after = true'].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Close the template on line 1
    const newCode = ['const s = `open', 'still template`', 'const after = true'].join('\n')

    const patch = tokenizer.update(newCode)

    // Line 2 must be retokenized (was template, now normal code)
    expect(patch.toLine).toBeGreaterThanOrEqual(3)
    // Verify the final line is tokenized as code, not as template content
    const afterLine = tokenizer.getSnapshot().lines[2]!
    expect(afterLine.text).toBe('const after = true')
    // Report the tokens rather than a bare `false`. This assertion has failed once under the root
    // runner and never in 25 isolated runs, and which way it failed is the whole question: one
    // token holding the line means the grammar answered nothing, several means it answered wrong.
    expect(afterLine.tokens.map((t) => t.content)).toContain('const')
  })

  it('template literal: nested ${} expression preserves depth', async () => {
    const code = ['const s = `a ${', '  x + y', '} b ${', '  z', '} c`', 'const after = true'].join(
      '\n',
    )

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Edit inside the first interpolation
    const patch = tokenizer.update(code.replace('x + y', 'x * y'))

    expect(patch.fromLine).toBe(1)
    // Should stabilize before the trailing statement
    expect(patch.toLine).toBeLessThanOrEqual(5)
    expect(tokenizer.getSnapshot().lines[5]?.text).toBe('const after = true')
  })

  // ── CSS-in-JS (tagged templates) ────────────────────────────

  it('css-in-js: edit inside tagged template does not leak past closing backtick', async () => {
    const code = [
      'const styles = css`',
      '  color: red;',
      '  font-size: 14px;',
      '`',
      'const after = true',
    ].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    const patch = tokenizer.update(code.replace('red', 'blue'))

    expect(patch.fromLine).toBe(1)
    expect(patch.toLine).toBeLessThanOrEqual(4)
    expect(tokenizer.getSnapshot().lines[4]?.text).toBe('const after = true')
  })

  it('css-in-js: removing closing backtick retokenizes suffix', async () => {
    const code = ['const styles = css`', '  color: red;', '`', 'const after = true'].join('\n')

    const { tokenizer, highlighter } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
    })

    highlighters.push(highlighter)

    // Remove closing backtick → template stays open
    const patch = tokenizer.update(
      ['const styles = css`', '  color: red;', '', 'const after = true'].join('\n'),
    )

    // `const after = true` is now inside the template
    expect(patch.toLine).toBeGreaterThanOrEqual(4)
  })

  // ── Cross-cutting: result integrity ──────────────────────────

  it('full retokenization matches incremental result for all tested constructs', async () => {
    const original = [
      'function App() {',
      '  const s = `hello ${',
      '    name',
      '  }`',
      '  return <div>{s}</div>',
      '}',
    ].join('\n')

    const edited = original.replace('name', 'name.toUpperCase()')

    const { tokenizer: incremental, highlighter: h1 } = await createIncrementalTokenizer({
      lang: 'tsx',
      theme: 'github-dark',
      code: original,
    })
    const { tokenizer: fresh, highlighter: h2 } = await createIncrementalTokenizer({
      lang: 'tsx',
      theme: 'github-dark',
      code: edited,
    })

    highlighters.push(h1, h2)

    incremental.update(edited)

    const incLines = incremental.getSnapshot().lines.map((l) => flattenTokens(l.tokens))
    const freshLines = fresh.getSnapshot().lines.map((l) => flattenTokens(l.tokens))

    expect(incLines).toEqual(freshLines)
  })

  it('does not let shiki abandon a line on a wall clock', async () => {
    // Shiki's default 500ms per-line budget is measured with Date.now(), so whether a line is
    // tokenized or abandoned depends on what else the machine is doing. Abandoning returns the
    // line as one token and the incoming stack unadvanced, and this tokenizer feeds that stack to
    // the next line and caches it — so a busy moment re-colours everything after it. This is the
    // bug that made the template-literal case above fail about once in forty runs of the full
    // suite, and never once on an idle machine.
    const real = await createHighlighter({ themes: ['github-dark'], langs: ['typescript'] })
    const tokenize = vi.spyOn(real.getLanguage('typescript'), 'tokenizeLine')
    const { tokenizer } = await createCoreIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code: 'const a = 1',
      highlighter: real,
    })
    tokenizer.update('const a = 1\nconst b = 2')

    highlighters.push(real)

    expect(tokenize.mock.calls.length).toBeGreaterThan(0)
    expect(tokenize.mock.calls.every((args) => args[2] === 0)).toBe(true)
  })
})
