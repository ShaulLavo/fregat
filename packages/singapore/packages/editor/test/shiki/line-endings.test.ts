import { afterAll, describe, expect, it } from 'vitest'
import { createHighlighter, type Highlighter } from 'shiki'

import {
  createIncrementalTokenizer,
  DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH,
} from '../../src/shiki'
import { packTokenLines, snapshotToPackedEditorTokens } from '../../src/shiki/editor-tokens'
import type { IncrementalTokenizer, TokenPatch } from '../../src/shiki/tokenizer'
import { unpackEditorTokens } from '../../src/syntax/packedTokens'
import { EditorTokenStore } from '../../src/syntax/tokenStore'
import type { EditorToken } from '../../src/tokens'

let highlighter: Highlighter | null = null

afterAll(() => highlighter?.dispose())

async function tokenizerFor(code: string): Promise<IncrementalTokenizer> {
  highlighter ??= await createHighlighter({ themes: ['github-dark'], langs: ['typescript'] })
  const { tokenizer } = await createIncrementalTokenizer({
    lang: 'typescript',
    theme: 'github-dark',
    code,
    highlighter,
    maxLineLength: DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH,
  })
  return tokenizer
}

function published(tokenizer: IncrementalTokenizer): EditorToken[] {
  return unpackEditorTokens(snapshotToPackedEditorTokens(tokenizer.getSnapshot()))
}

async function tokensOf(code: string): Promise<EditorToken[]> {
  return published(await tokenizerFor(code))
}

/**
 * The same text with every CRLF as LF, whose offsets are known good, mapped back onto the
 * submitted text: each LF that stood for a CRLF pushes every later offset one unit on.
 */
async function lfOracle(code: string): Promise<EditorToken[]> {
  const pairs: number[] = []
  const lf = code.replace(/\r\n/g, (_match, offset: number) => {
    pairs.push(offset - pairs.length)
    return '\n'
  })
  const toRaw = (offset: number) => offset + pairs.filter((pair) => pair < offset).length
  const tokens = await tokensOf(lf)
  return tokens.map((token) => ({ ...token, start: toRaw(token.start), end: toRaw(token.end) }))
}

function keywordStarts(code: string, tokens: readonly EditorToken[]): number[] {
  return tokens
    .filter((token) => code.slice(token.start, token.end) === 'const')
    .map((token) => token.start)
}

/** Worker and client together: pack each patch at its own offsets, splice it into the store. */
function applyPatches(store: EditorTokenStore, patches: readonly TokenPatch[]): EditorTokenStore {
  return patches.reduce(
    (current, patch) =>
      current.applyPatch({
        fromOffset: patch.fromOffset,
        oldEndOffset: patch.oldEndOffset,
        newEndOffset: patch.newEndOffset,
        tokensPacked: packTokenLines(patch.lines, patch.fromOffset),
      }),
    store,
  )
}

async function expectPatchedLikeFresh(
  code: string,
  change: (tokenizer: IncrementalTokenizer) => readonly TokenPatch[],
): Promise<string> {
  const tokenizer = await tokenizerFor(code)
  const before = EditorTokenStore.fromPacked(snapshotToPackedEditorTokens(tokenizer.getSnapshot()))
  const after = applyPatches(before, change(tokenizer))
  const next = tokenizer.getCode()

  expect(after.toTokens()).toEqual(await tokensOf(next))
  expect(after.toTokens()).toEqual(await lfOracle(next))
  return next
}

const LINES = ['const a = 1;', 'const b = 2;', 'const c = 3;']

describe('Shiki offsets into text with CRLF and lone CR', () => {
  it('publishes offsets into the submitted CRLF text', async () => {
    const code = LINES.join('\r\n')
    const tokens = await tokensOf(code)

    expect(keywordStarts(code, tokens)).toEqual([0, 14, 28])
    expect(tokens).toEqual(await lfOracle(code))
  })

  it('keeps a terminated final line exact', async () => {
    const code = `${LINES.join('\r\n')}\r\n`
    const tokenizer = await tokenizerFor(code)

    expect(published(tokenizer)).toEqual(await lfOracle(code))
    expect(tokenizer.getSnapshot().lines).toMatchObject([
      { text: LINES[0], lineEnding: '\r\n' },
      { text: LINES[1], lineEnding: '\r\n' },
      { text: LINES[2], lineEnding: '\r\n' },
      { text: '', lineEnding: '' },
    ])
  })

  it('keeps each separator its own width in mixed text', async () => {
    const code = `${LINES[0]}\n${LINES[1]}\r\n${LINES[2]}\n`
    const tokens = await tokensOf(code)

    expect(keywordStarts(code, tokens)).toEqual([0, 13, 27])
    expect(tokens).toEqual(await lfOracle(code))
  })

  it('tokenizes a lone CR as line text, as Shiki splits lines', async () => {
    const code = `${LINES[0]}\r${LINES[1]}\r\n${LINES[2]}\r`
    const tokenizer = await tokenizerFor(code)

    expect(tokenizer.getSnapshot().lines).toMatchObject([
      { text: `${LINES[0]}\r${LINES[1]}`, lineEnding: '\r\n' },
      { text: `${LINES[2]}\r`, lineEnding: '' },
    ])
    expect(published(tokenizer)).toEqual(await lfOracle(code))
    expect(keywordStarts(code, published(tokenizer))).toContain(27)
  })
})

describe('incremental Shiki patches over CRLF text', () => {
  const code = LINES.join('\r\n')

  it('patches an edit inside a CRLF line', async () => {
    await expectPatchedLikeFresh(code, (tokenizer) => [
      tokenizer.applyEdit({ from: 20, to: 21, text: '42' }),
    ])
  })

  it('patches an inserted CRLF line and a deletion across a CRLF', async () => {
    const next = await expectPatchedLikeFresh(code, (tokenizer) => [
      tokenizer.applyEdit({ from: 14, to: 14, text: 'let z = 0;\r\n' }),
    ])
    await expectPatchedLikeFresh(next, (tokenizer) => [
      tokenizer.applyEdit({ from: 10, to: 16, text: '' }),
    ])
  })

  it('patches edits that land between a CR and its LF', async () => {
    const splitPair = await expectPatchedLikeFresh(code, (tokenizer) => [
      tokenizer.applyEdit({ from: 13, to: 14, text: '' }),
    ])
    expect(splitPair).toBe(`${LINES[0]}\r${LINES[1]}\r\n${LINES[2]}`)

    await expectPatchedLikeFresh(code, (tokenizer) => [
      tokenizer.applyEdit({ from: 13, to: 13, text: 'x' }),
    ])
  })

  it('patches a batch applied highest-first', async () => {
    await expectPatchedLikeFresh(code, (tokenizer) =>
      tokenizer.applyEdits([
        { from: 6, to: 7, text: 'first' },
        { from: 34, to: 35, text: 'third' },
      ]),
    )
  })

  it('patches a whole-text update that only changes line endings', async () => {
    await expectPatchedLikeFresh(LINES.join('\n'), (tokenizer) => [tokenizer.update(code)])
  })

  it('patches a stream whose chunk ends between a CR and its LF', async () => {
    await expectPatchedLikeFresh(`${LINES[0]}\r`, (tokenizer) => [
      tokenizer.update(`${LINES[0]}\r\n${LINES[1]}`),
    ])
  })
})
