import { ok } from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'

import { MARKDOWN_CASES, type MarkdownCase } from '../../../test/fixtures/cases'
import {
  checkExpectations,
  createRemarkReplay,
  observeHast,
  renderRemark,
} from '../../../test/qualification'
import { CASE_SOURCE_HASHES } from '../../../test/fixtures/hashes'

test('the owned corpus has frozen sources and independently authored coverage', () => {
  expect(MARKDOWN_CASES.length).toBeGreaterThanOrEqual(80)
  expect(new Set(MARKDOWN_CASES.map((fixture) => fixture.id)).size).toBe(MARKDOWN_CASES.length)
  expect(Object.keys(CASE_SOURCE_HASHES)).toHaveLength(MARKDOWN_CASES.length)
  expect(
    MARKDOWN_CASES.filter((fixture) => fixture.checkpoints.length > 0).length,
  ).toBeGreaterThanOrEqual(32)
  expect(
    MARKDOWN_CASES.filter((fixture) => fixture.tags.includes('visual')).length,
  ).toBeGreaterThanOrEqual(32)
  expect(
    MARKDOWN_CASES.filter((fixture) => fixture.tags.includes('webkit-critical')).length,
  ).toBeGreaterThanOrEqual(8)
  for (const fixture of MARKDOWN_CASES) checkManifest(fixture)
})

test.each(MARKDOWN_CASES)(
  '$id: completed safe output matches its owned expectations',
  (fixture) => {
    const observation = observeHast(renderRemark(fixture.source, false))
    expect(checkExpectations(observation, fixture.expected)).toEqual([])
  },
)

test('nested emphasis remains inside strong and quoted lists remain inside quotes', () => {
  const emphasis = observeHast(renderRemark(findCase('nested-emphasis').source, false))
  expect(emphasis.elements.find((element) => element.tag === 'em')?.parents).toEqual([
    'p',
    'strong',
  ])
  const quote = observeHast(renderRemark(findCase('quote-list').source, false))
  expect(quote.elements.find((element) => element.tag === 'li')?.parents).toEqual([
    'blockquote',
    'ul',
  ])
})

test('late reference additions, edits and removals update earlier destinations', () => {
  const replay = createRemarkReplay()
  const before = 'Early [guide][docs].\n\nLater paragraph.'
  assertLink(replay, before, null)
  assertLink(replay, `${before}\n\n[docs]: /first "First"`, '/first', 'First')
  assertLink(replay, `${before}\n\n[docs]: /edited "Edited"`, '/edited', 'Edited')
  assertLink(replay, before, null)
  assertLink(replay, `[docs]: /before\n\n${before}`, '/before')
})

test('duplicate definitions, replacements and undo follow authored semantics', () => {
  const replay = createRemarkReplay()
  assertLink(replay, '[guide][docs]\n\n[docs]: /first\n[docs]: /second', '/first')
  assertLink(replay, '[guide][docs]\n\n[docs]: /second', '/second')
  const replacement = replay.update('# Replacement\n\nCompletely new source.', false)
  expect(
    checkExpectations(observeHast(replacement), [
      { tag: 'h1', count: 1, texts: ['Replacement'] },
      { tag: 'p', count: 1, texts: ['Completely new source.'] },
      { tag: 'a', count: 0 },
    ]),
  ).toEqual([])
  assertLink(replay, '[guide][docs]\n\n[docs]: /first\n[docs]: /second', '/first')
})

test('independent simultaneous sessions and repeated replacement cycles preserve their own source', () => {
  const left = createRemarkReplay()
  const right = createRemarkReplay()
  for (let cycle = 0; cycle < 20; cycle += 1) {
    assertLink(left, `[guide][docs]\n\n[docs]: /left-${cycle}`, `/left-${cycle}`)
    assertLink(right, `[guide][docs]\n\n[docs]: /right-${cycle}`, `/right-${cycle}`)
    expect(left.update('left **open', true)).toEqual(renderRemark('left **open', true))
    expect(right.update('right `open', true)).toEqual(renderRemark('right `open', true))
  }
})

test.each([
  ['two-paragraphs', 'First paragraph.'],
  ['direct-link', 'Read [the guide](https://wrong.example/guide).'],
  ['ordered-start', '3. seventh\n4. eighth'],
  ['table-thirteen-columns', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
  ['plain-paragraph', 'One'],
])('negative control rejects changed output for %s', (id, alteredSource) => {
  const fixture = findCase(id)
  expect(
    checkExpectations(observeHast(renderRemark(alteredSource, false)), fixture.expected).length,
  ).toBeGreaterThan(0)
})

test('negative control rejects an empty rendering and preserves significant code whitespace', () => {
  const fixture = findCase('fenced-whitespace')
  expect(
    checkExpectations(observeHast({ type: 'root', children: [] }), fixture.expected).length,
  ).toBeGreaterThan(0)
  const trimmed = fixture.source.replace('  a', 'a').replace('\tb  ', 'b')
  expect(
    checkExpectations(observeHast(renderRemark(trimmed, false)), fixture.expected).length,
  ).toBeGreaterThan(0)
})

function checkManifest(fixture: MarkdownCase): void {
  expect(fixture.sha256).toBe(createHash('sha256').update(fixture.source).digest('hex'))
  expect(fixture.provenance.kind).toBe('owned')
  expect(fixture.expected.length).toBeGreaterThan(0)
  for (const checkpoint of fixture.checkpoints) {
    expect(checkpoint.offset).toBeGreaterThanOrEqual(0)
    expect(checkpoint.offset).toBeLessThanOrEqual(fixture.source.length)
    expect(checkpoint.expected.length).toBeGreaterThan(0)
  }
}

function findCase(id: string): MarkdownCase {
  const fixture = MARKDOWN_CASES.find((candidate) => candidate.id === id)
  ok(fixture, `Missing qualification fixture ${id}`)
  return fixture
}

function assertLink(
  replay: ReturnType<typeof createRemarkReplay>,
  source: string,
  destination: string | null,
  title: string | null = null,
): void {
  const observation = observeHast(replay.update(source, false))
  if (destination === null) {
    expect(observation.elements.filter((element) => element.tag === 'a')).toEqual([])
    return
  }
  expect(
    checkExpectations(observation, [
      { tag: 'a', count: 1, texts: ['guide'], attributes: [{ href: destination, title }] },
    ]),
  ).toEqual([])
}
