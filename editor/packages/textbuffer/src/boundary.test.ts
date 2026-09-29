import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  insertIntoPieceTable,
  materializePieceTableFullText,
} from './index'
import { recordTextBufferDiagnostic, setTextBufferDiagnosticSink } from './diagnostics'

const sourceRoot = fileURLToPath(new URL('.', import.meta.url))
afterEach(() => setTextBufferDiagnosticSink(undefined))

describe('standalone storage boundary', () => {
  it('has no runtime or type imports outside its source directory', () => {
    for (const filename of readdirSync(sourceRoot)) {
      if (!filename.endsWith('.ts') || filename.endsWith('.test.ts')) continue
      const text = readFileSync(path.join(sourceRoot, filename), 'utf8')
      for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
        expect(imported.fileName.startsWith('.'), filename + ': ' + imported.fileName).toBe(true)
        const target = path.resolve(sourceRoot, imported.fileName)
        expect(
          path.relative(sourceRoot, target).startsWith('..'),
          filename + ': ' + imported.fileName,
        ).toBe(false)
      }
    }
  })

  it('shares a lineage key across versions, not across independent documents', () => {
    const original = createPieceTableSnapshot('abc')
    const left = insertIntoPieceTable(original, 0, 'L')
    const right = insertIntoPieceTable(original, 0, 'R')
    expect(left.buffers.identity).toBe(original.buffers.identity)
    expect(right.buffers.identity).toBe(original.buffers.identity)
    expect(createPieceTableSnapshot('abc').buffers.identity).not.toBe(original.buffers.identity)
    expect(materializePieceTableFullText(original)).toBe('abc')
    expect(materializePieceTableFullText(left)).toBe('Labc')
    expect(materializePieceTableFullText(right)).toBe('Rabc')
    expect('textIndexes' in original.buffers).toBe(false)
  })

  it('keeps diagnostics lazy and disabled by default', () => {
    const detail = vi.fn(() => ({ scannedCodeUnits: 10 }))
    recordTextBufferDiagnostic('sourceIndex', detail)
    expect(detail).not.toHaveBeenCalled()
    const sink = vi.fn((name, fields) => ({ name, detail: fields() }))
    setTextBufferDiagnosticSink(sink)
    recordTextBufferDiagnostic('sourceIndex', detail)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(detail).toHaveBeenCalledTimes(1)
  })

  it('matches a string oracle through deterministic edits and retains old snapshots', () => {
    let state = 123456789
    const random = (max) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state % max
    }
    let expected = 'alpha\nbeta'
    let snapshot = createPieceTableSnapshot(expected)
    const retained = []
    for (let index = 0; index < 1000; index += 1) {
      if (index % 100 === 0) retained.push({ snapshot, text: expected })
      const from = random(expected.length + 1)
      const to = from + random(expected.length - from + 1)
      const text = ['x', '\n', 'word', ''][random(4)]
      snapshot = applyBatchToPieceTable(snapshot, [{ from, to, text }])
      expected = expected.slice(0, from) + text + expected.slice(to)
      expect(materializePieceTableFullText(snapshot)).toBe(expected)
    }
    for (const previous of retained)
      expect(materializePieceTableFullText(previous.snapshot)).toBe(previous.text)
  })
})
