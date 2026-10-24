import type {
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { describe, expect, it, vi } from 'vitest'
import { createTestViewContributionContext } from '@singapore-editor/core/testing'

import { LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE } from '../src/completion'
import { FormatOnTypeController } from '../src/formatOnType'

/*
 * What a keystroke costs, counted rather than reasoned about.
 *
 * The document is read through a snapshot that keeps a tally, which is the one thing a real editor
 * will not tell a suite: a scan that grows with the file reads as a number here instead of as a
 * stutter in a file nobody writes a test with. The answer itself is checked at the same size, so a
 * reading that got cheap by getting wrong cannot pass.
 */

const BLOCK = [
  'function f(a) {',
  '    if (a) {',
  '        return "} not a block"',
  '    }',
  '    // } neither is this',
  '}',
  '',
].join('\n')

/** The keystroke every case here makes: a closing brace, alone on the last row, one level too deep. */
const TAIL = 'function g() {\n    return 1\n    }'

type Keystroke = {
  readonly charactersRead: number
  readonly documentLength: number
  readonly applied: readonly unknown[]
}

describe('what a closing brace reads to find its row', () => {
  it('reads the same amount of a long document as of a short one', async () => {
    const short = await typeClosingBrace(BLOCK.repeat(80) + TAIL)
    const long = await typeClosingBrace(BLOCK.repeat(800) + TAIL)

    expect(long.documentLength).toBeGreaterThan(4 * short.documentLength)
    expect(long.charactersRead).toBe(short.charactersRead)
    expect(long.charactersRead).toBeLessThan(short.documentLength)
  })

  it('puts the row back at the level its block is at', async () => {
    const { applied, documentLength } = await typeClosingBrace(BLOCK.repeat(800) + TAIL)

    expect(applied).toEqual([
      {
        edits: [{ from: documentLength - 5, to: documentLength - 1, text: '' }],
        selection: { anchor: documentLength - 4, head: documentLength - 4 },
      },
    ])
  })

  // A row that is itself longer than what a keystroke reads puts its own start out of reach, and a
  // level measured from half a row is a level read off text the row does not begin with.
  it('says nothing when the caret is further from a row start than it reads', async () => {
    const { applied } = await typeClosingBrace(
      `${BLOCK.repeat(80)}function g() {\n${' '.repeat(5000)}}`,
    )

    expect(applied).toEqual([])
  })
})

async function typeClosingBrace(text: string): Promise<Keystroke> {
  const caretOffset = text.length
  const applied: unknown[] = []
  let charactersRead = 0

  const snapshot = countedSnapshot(text, caretOffset, (count) => {
    charactersRead += count
  })
  const controller = new FormatOnTypeController({
    context: createTestViewContributionContext({
      getSnapshot: () => snapshot,
      getFeature: (() => ({
        applyCompletion: (application: unknown) => {
          applied.push(application)
          return true
        },
      })) as EditorViewContributionContext['getFeature'],
    }),
    editFeature: LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE,
  })

  controller.update(snapshot, 'content', {
    kind: 'edit',
    edits: [{ from: caretOffset - 1, to: caretOffset - 1, text: '}' }],
  } as unknown as Parameters<FormatOnTypeController['update']>[2])
  await Promise.resolve()
  await Promise.resolve()
  controller.dispose()

  return { applied, charactersRead, documentLength: text.length }
}

/** The document behind a piece table, which is read in ranges and materialized only if asked. */
function countedSnapshot(
  text: string,
  caretOffset: number,
  count: (characters: number) => void,
): EditorViewSnapshot {
  return {
    documentId: 'src/index.ts',
    languageId: 'typescript',
    textVersion: 7,
    tabSize: 4,
    lineCount: 1,
    tokens: [],
    brackets: [],
    foldMarkers: [],
    visibleRows: [],
    lineStarts: [0],
    selections: [
      {
        anchorOffset: caretOffset,
        headOffset: caretOffset,
        startOffset: caretOffset,
        endOffset: caretOffset,
      },
    ],
    textSnapshot: {
      length: text.length,
      readRange: (start: number, end: number) => {
        count(Math.max(0, end - start))
        return text.slice(start, end)
      },
      forEachTextChunk: vi.fn(),
    },
  } as unknown as EditorViewSnapshot
}
