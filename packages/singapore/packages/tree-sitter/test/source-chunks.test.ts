import { afterEach, describe, expect, it } from 'vitest'
import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import {
  defineDocumentOperation,
  DocumentWorkerReader,
  type DocumentSourceConnection,
} from '@singapore-editor/core/internal/document-worker'
import {
  createTreeSitterInput,
  readTreeSitterInputRange,
  readTreeSitterPieceTableInput,
} from '../src/treeSitter/source'

const UNIT = 'const 名前 = "emoji 🎉🚀 tail"; // ünïcødé\n'
const TEXT = UNIT.repeat(2_000)
const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})

async function resolve(text: string, edit?: { from: number; to: number; text: string }) {
  const buffer = createEditorTextBuffer(text)
  if (edit) createEditorBufferSession(buffer).applyEdits([edit])
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'chunks.ts' })
  const reader = new DocumentWorkerReader()
  let registration = 0
  const connection: DocumentSourceConnection = {
    generation: 1,
    nextRegistration: () => ++registration,
    send: async (command) => reader.apply(command),
    release: (identity) => {
      reader.apply({ kind: 'release', identity })
    },
  }
  const operation = defineDocumentOperation(
    (context) => ({
      analyze: async (read) => {
        const prepared = await context.source.prepareReader(
          { connect: async () => connection },
          read,
        )
        if (!prepared) throw new TypeError('The actual canonical source must be admitted')
        const loan = reader.acquire(prepared.reference)
        if (!loan) throw new TypeError('The admitted worker read must be available')
        await prepared.dispose()
        return createTreeSitterInput(loan)
      },
      dispose: () => {},
    }),
    () => true,
  )
  const lease = analysis.contributions.retain(operation, null)!
  const input = await lease.request()
  cleanup.push(() => {
    input.dispose()
    lease.dispose()
    analysis.dispose()
    reader.dispose()
  })
  return { input, buffer }
}

describe('ordinary source reads', () => {
  it('bounds predicate reads while preserving parser batches', async () => {
    const { input } = await resolve('alpha' + ' '.repeat(10_000))
    expect(readTreeSitterPieceTableInput(input, 0, 5)).toBe('alpha')
    expect(readTreeSitterPieceTableInput(input, 0)).toHaveLength(4096)
    expect(readTreeSitterPieceTableInput(input, 2, 2)).toBe('')
  })

  it('preserves exact bounded UTF-16 ranges at surrogate boundaries', async () => {
    const { input } = await resolve('a🎉z' + ' '.repeat(5_000))
    expect(readTreeSitterPieceTableInput(input, 1, 3)).toBe('🎉')
    expect(readTreeSitterPieceTableInput(input, 1, 2)).toBe('\ud83c')
    expect(readTreeSitterPieceTableInput(input, 2, 3)).toBe('\udf89')
  })

  it('keeps the parser callback source alive until its cached input retires', async () => {
    const { input } = await resolve('const mdx = "😀"')
    const cached = input.retain()
    input.dispose()
    expect(readTreeSitterInputRange(input, 0, input.length)).toBe('const mdx = "😀"')
    cached.dispose()
    expect(() => readTreeSitterInputRange(input, 0, input.length)).toThrow(
      'Document source scope was released',
    )
  })

  it('reads an edited multi-piece document across many chunks', async () => {
    const middle = Math.floor(TEXT.length / 2)
    const { input, buffer } = await resolve(TEXT, { from: middle, to: middle, text: 'INSERTED🌍' })
    expect(readTreeSitterInputRange(input, 0, input.length)).toBe(buffer.materializeFullText())
  })
  it('reads ranges across former chunk boundaries', async () => {
    const { input } = await resolve(TEXT)
    for (const [start, end] of [
      [0, 10],
      [16_380, 16_400],
      [100, 50_000],
      [input.length - 5, input.length],
    ])
      expect(readTreeSitterInputRange(input, start!, end!)).toBe(TEXT.slice(start, end))
  })
  it('keeps a surrogate pair across the former chunk boundary', async () => {
    const text = `${'a'.repeat(16 * 1024 - 1)}🎉${'b'.repeat(64)}`
    const { input } = await resolve(text)
    expect(readTreeSitterInputRange(input, 0, input.length)).toBe(text)
  })
  it('preserves U+FEFF inside source near the former chunk boundary', async () => {
    const text = `${'a'.repeat(16 * 1024)}﻿tail`
    const { input } = await resolve(text)
    expect(readTreeSitterInputRange(input, 0, input.length)).toBe(text)
  })
})
