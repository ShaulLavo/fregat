import { describe, expect, beforeAll, test } from 'vitest'
import { hash } from 'node:crypto'

import commonmark from '../../../test/reference/commonmark.json'
import gfm from '../../../test/reference/gfm.json'
import differences from '../../../test/reference/gfm-differences.json'
import {
  canonicalMarkdownOutput,
  expectedOutput,
  referenceOutput,
} from '../../../test/reference/oracle'
import { MARKDOWN_CASES } from '../../../test/fixtures/cases'
import { checkExpectations, observeHast, createRemarkReplay } from '../../../test/qualification'
import { seededChunks, adversarialUtf16, everyPrefix } from '../../../test/schedules'
import {
  blockToHast,
  createHastProcessor,
  loadRawHastExtension,
  type HastProcessor,
  type HastExtensions,
} from '../hast'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
  parseTreeSitterMarkdown,
} from '../tree-sitter-session'
let safeProcessor: HastProcessor
let loadedHtml: HastExtensions

beforeAll(async () => {
  await initializeTreeSitterMarkdown()
  const { default: raw } = await loadRawHastExtension()
  loadedHtml = { raw, math: null }
  safeProcessor = createHastProcessor(loadedHtml)
})

describe('Tree-sitter completed semantics against the official output', () => {
  test.each(commonmark)('$id CommonMark includes decoded text and complete nesting', (example) => {
    const parsed = parseTreeSitterMarkdown(example.source, { gfm: false })
    expect(canonicalMarkdownOutput(parsed)).toEqual(expectedOutput(example.html))
  })

  test.each(gfm)('$id GFM includes every column, list start, URL and title', (example) => {
    const parsed = parseTreeSitterMarkdown(example.source, { gfm: true })
    const actual = canonicalMarkdownOutput(parsed)
    const expected = expectedOutput(example.html)
    const difference = differences.find((entry) => entry.id === example.id)
    if (difference) {
      const candidateSha256 = difference.candidateSha256 ?? difference.actualSha256
      expect(hash('sha256', JSON.stringify(actual), 'hex')).toBe(candidateSha256)
      expect(hash('sha256', JSON.stringify(expected), 'hex')).toBe(difference.expectedSha256)
      expect(actual).toEqual(
        difference.candidateSha256 ? expected : referenceOutput(example.source, 'gfm'),
      )
      return
    }
    expect(actual).toEqual(expected)
  })
})

function candidateReplay() {
  const session = createTreeSitterMarkdownSession()
  return (text: string, live: boolean) => ({
    type: 'root' as const,
    children: session
      .update(text, { heal: live })
      .flatMap((block) => blockToHast(block, safeProcessor).children),
  })
}

describe('Tree-sitter actual product semantics', () => {
  test.each(MARKDOWN_CASES)(
    '$id preserves the completed independently authored expectation',
    (fixture) => {
      const actual = candidateReplay()(fixture.source, false)
      expect(checkExpectations(observeHast(actual), fixture.expected)).toEqual([])
      expect(observeHast(actual)).toEqual(
        observeHast(createRemarkReplay({ extensions: loadedHtml }).update(fixture.source, false)),
      )
    },
  )

  test.each(MARKDOWN_CASES.filter((fixture) => fixture.checkpoints.length > 0))(
    '$id paints all live checkpoints and settles to fresh candidate output',
    (fixture) => {
      const replay = candidateReplay()
      for (const checkpoint of fixture.checkpoints) {
        const actual = observeHast(
          replay(fixture.source.slice(0, checkpoint.offset), checkpoint.live),
        )
        expect(checkExpectations(actual, checkpoint.expected)).toEqual([])
        for (const text of checkpoint.textIncludes ?? []) expect(actual.text).toContain(text)
        for (const text of checkpoint.textExcludes ?? []) expect(actual.text).not.toContain(text)
      }
      expect(observeHast(replay(fixture.source, false))).toEqual(
        observeHast(candidateReplay()(fixture.source, false)),
      )
    },
  )

  test.each(MARKDOWN_CASES.filter((fixture) => fixture.source.length <= 512))(
    '$id remains equivalent to a fresh candidate at every UTF-16 prefix',
    (fixture) => {
      const replay = candidateReplay()
      for (const revision of adversarialUtf16(fixture.source)) {
        expect(observeHast(replay(revision.text, true))).toEqual(
          observeHast(candidateReplay()(revision.text, true)),
        )
      }
    },
  )

  test.each(MARKDOWN_CASES.filter((fixture) => fixture.source.length <= 512))(
    '$id matches the live remark projection at every complete Unicode prefix',
    (fixture) => {
      const replay = candidateReplay()
      for (const revision of everyPrefix(fixture.source)) {
        expect(observeHast(replay(revision.text, true)), `prefix ${revision.offset}`).toEqual(
          observeHast(createRemarkReplay({ extensions: loadedHtml }).update(revision.text, true)),
        )
      }
    },
  )

  test.each(MARKDOWN_CASES)('$id settles over a deterministic transport schedule', (fixture) => {
    const replay = candidateReplay()
    for (const revision of seededChunks(fixture.source, { seed: 176, maxUnits: 24 }))
      replay(revision.text, true)
    expect(observeHast(replay(fixture.source, false))).toEqual(
      observeHast(candidateReplay()(fixture.source, false)),
    )
  })
})
