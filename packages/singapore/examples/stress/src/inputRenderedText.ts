import { createError } from '@singapore-editor/core/logging/evlog'

type RenderedChunk = {
  readonly start: number
  readonly end: number
  readonly text: string
}

export type RenderedRowText =
  | { readonly kind: 'direct'; readonly text: string }
  | {
      readonly kind: 'chunked'
      readonly start: number
      readonly end: number
      readonly chunks: readonly RenderedChunk[]
    }

export function verifyRenderedText(row: RenderedRowText, expected: string): number {
  if (row.kind === 'direct') {
    check(row.text === expected, 'Incorrect rendered row text')
    return 1
  }
  verifyRange(row.start, row.end, expected.length)
  check(row.chunks.length > 0, 'The rendered window has no chunks')
  let end = row.start
  for (const chunk of row.chunks) {
    verifyRange(chunk.start, chunk.end, row.end)
    check(chunk.start === end, 'Rendered chunks do not cover a continuous window')
    check(
      chunk.text === expected.slice(chunk.start, chunk.end),
      `Stale rendered text at column ${chunk.start}`,
    )
    end = chunk.end
  }
  check(end === row.end, 'Rendered chunks do not reach the end of the window')
  return row.chunks.length
}

function verifyRange(start: number, end: number, length: number) {
  check(
    Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= length,
    'Invalid rendered text range',
  )
}

function check(value: unknown, message: string): asserts value {
  if (value) return
  throw createError({
    message,
    status: 422,
    code: 'INPUT_RENDERING_INVALID',
    why: 'Rendered text did not cover its declared source range.',
    fix: 'Inspect the mounted row, chunk boundaries, and text.',
  })
}
