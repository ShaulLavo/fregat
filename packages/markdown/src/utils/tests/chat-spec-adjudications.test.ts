import { createHash } from 'node:crypto'
import { beforeAll, expect, test } from 'vitest'

import adjudications from '../../../test/reference/chat-spec-adjudications.json'
import {
  canonicalMarkdownOutput,
  expectedOutput,
  referenceOutput,
} from '../../../test/reference/oracle'
import { initializeTreeSitterMarkdown, parseTreeSitterMarkdown } from '../tree-sitter-session'

beforeAll(() => initializeTreeSitterMarkdown())

test('the development adjudications remain an explicit exact-source set', () => {
  expect(adjudications.map((fixture) => fixture.id)).toEqual([
    'chat-spec-emphasis-original',
    'chat-spec-emphasis-reduced',
    'chat-spec-emphasis-punctuation-only',
    'chat-spec-emphasis-upstream-177',
    'chat-spec-emphasis-partial-closer',
    'chat-spec-list-code-original-lf',
    'chat-spec-list-code-reduced',
  ])
  for (const fixture of adjudications) {
    expect(fixture.provenance.kind).toBe('exact-source-spec-adjudication')
    expect(fixture.provenance.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(fixture.provenance.case.length).toBeGreaterThan(0)
    expect(fixture.independentOracle.specVersion).toBe('0.31.2')
    expect(fixture.profile.math).toBe(false)
    expect(fixture.profile.cjk).toBe(false)
    expect(fixture.affectedField.length).toBeGreaterThan(0)
    expect(fixture.reason.length).toBeGreaterThan(40)
  }
})

test.each(adjudications)('$id preserves the exact authored UTF-8 source', (fixture) => {
  expect(createHash('sha256').update(fixture.source, 'utf8').digest('hex')).toBe(
    fixture.sourceUtf8Sha256,
  )
})

test.each(adjudications)(
  '$id matches the full independently expected candidate shape',
  (fixture) => {
    const parsed = parseTreeSitterMarkdown(fixture.source, fixture.profile)
    expect(canonicalMarkdownOutput(parsed)).toEqual(
      expectedOutput(fixture.independentOracle.expectedHtml),
    )
  },
)

test.each(adjudications)('$id retains an explicit fresh reference disagreement', (fixture) => {
  const profile = fixture.profile.gfm ? 'gfm' : 'commonmark'
  const reference = referenceOutput(fixture.source, profile)
  expect(reference).toEqual(expectedOutput(fixture.remarkObserved.html))
  expect(reference).not.toEqual(expectedOutput(fixture.independentOracle.expectedHtml))
})

test('canonical expectations distinguish literal markers, nesting, code count and indentation', () => {
  expect(expectedOutput('<p>*<em>a</em>!<em>_</em></p>')).not.toEqual(
    expectedOutput('<p><em><em>a</em>!</em>_*</p>'),
  )
  expect(expectedOutput('<pre><code>a\nb\n</code></pre>')).not.toEqual(
    expectedOutput('<pre><code>a\n</code></pre>\n<pre><code>b\n</code></pre>'),
  )
  expect(expectedOutput('<pre><code>  a\n  b\n</code></pre>')).not.toEqual(
    expectedOutput('<pre><code>a\nb\n</code></pre>'),
  )
})
