import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import type { Buffer, Edit, Factory, Operation, Retention, TreeNode } from './contracts.ts'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { upstreamRoot } from './support.ts'

// When the Singapore adapter retains a snapshot, which decides how much of the
// tree an edit may mutate in place:
// - always: before every primitive edit; the library's default and today's cost
// - transaction: before every edit() and batch() call, so a replacement's insert
//   and a batch's later edits reuse the nodes the earlier ones created
// - history: only where a lane retains explicitly; the edit lanes never do
export const retentions: Retention[] = ['always', 'transaction', 'history']

export async function loadAdapter(
  name: string,
  roots: Partial<Record<'singapore' | 'vscode', string>> = {},
  retention: string = 'always',
): Promise<Factory> {
  if (retention !== 'always' && retention !== 'transaction' && retention !== 'history')
    throw new Error(`Unknown retention: ${retention}`)
  if (name === 'singapore') return singaporeAdapter(roots.singapore, retention)
  if (name === 'vscode') return vscodeAdapter(roots.vscode)
  throw new Error(`Unknown engine: ${name}`)
}

async function singaporeAdapter(root: string | undefined, retention: Retention): Promise<Factory> {
  const target = (file: string, specifier: string) =>
    root ? pathToFileURL(path.join(root, file)).href : specifier
  const api: typeof import('@singapore-editor/textbuffer') = await import(
    target('index.js', '@singapore-editor/textbuffer')
  )
  const transient = retention !== 'always'
  const retainPerCall = retention === 'transaction'
  const { validatePieceTreeInvariants }: typeof import('@singapore-editor/textbuffer/debug') =
    await import(target('debug.js', '@singapore-editor/textbuffer/debug'))
  function wrap(snapshot: PieceTableSnapshot): Buffer {
    return {
      get snapshot() {
        return snapshot
      },
      length: () => snapshot.length,
      lineCount: () => (snapshot.root?.subtreeLineBreaks ?? 0) + 1,
      edit(edit) {
        if (retainPerCall) api.retainPieceTableSnapshot(snapshot)
        // A replacement goes through the batch call, as the editor's do.
        if (edit.to > edit.from && edit.text.length) {
          snapshot = api.applyBatchToPieceTable(snapshot, [edit])
          return
        }
        if (edit.to > edit.from)
          snapshot = api.deleteFromPieceTable(snapshot, edit.from, edit.to - edit.from)
        if (edit.text.length) snapshot = api.insertIntoPieceTable(snapshot, edit.from, edit.text)
      },
      batch(edits) {
        if (retainPerCall) api.retainPieceTableSnapshot(snapshot)
        snapshot = api.applyBatchToPieceTable(snapshot, edits)
      },
      line: (row) => api.readPieceTableLine(snapshot, row),
      range: (from, to) => api.readPieceTableTextRange(snapshot, from, to),
      point: (offset) => api.offsetToPoint(snapshot, offset),
      offset: (point) => api.pointToOffset(snapshot, point),
      full: () => api.materializePieceTableFullText(snapshot),
      retain: () => api.retainPieceTableSnapshot(snapshot),
      anchor: (offset, bias) => api.anchorAt(snapshot, offset, bias),
      resolve: (anchor) => api.resolveAnchor(snapshot, anchor),
      resolveLinear: (anchor) => api.resolveAnchorLinear(snapshot, anchor),
      issues: () => validatePieceTreeInvariants(snapshot).issues,
      stats: () => ({ pieces: snapshot.pieceCount, chunks: snapshot.buffers.chunks.size }),
    }
  }
  return {
    create: (text) => wrap(api.createPieceTableSnapshot(text, { transient })),
    restore: wrap,
    retention,
    retainedText: api.materializePieceTableFullText,
  }
}

function vscodeAdapter(root: string | undefined): Factory {
  const require = createRequire(import.meta.url)
  const {
    PieceTreeTextBufferBuilder,
  }: {
    PieceTreeTextBufferBuilder: new () => {
      acceptChunk(text: string): void
      finish(normalize: boolean): { create(eol: number): VscodeTree }
    }
  } = require(path.join(root ?? path.join(upstreamRoot, 'dist'), 'pieceTreeBuilder.js'))
  return {
    create(text: string): Buffer {
      const builder = new PieceTreeTextBufferBuilder()
      builder.acceptChunk(text)
      // The fixture contract is already LF-only. Upstream's const enum LF = 1.
      const tree = builder.finish(true).create(1)
      function range(from: number, to: number) {
        const start = tree.getPositionAt(from)
        const end = tree.getPositionAt(to)
        return tree.getValueInRange({
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        })
      }
      function edit(change: Omit<Edit, 'kind'>) {
        if (change.to > change.from) tree.delete(change.from, change.to - change.from)
        if (change.text.length) tree.insert(change.from, change.text, true)
      }
      return {
        get tree() {
          return tree
        },
        length: () => tree.getLength(),
        lineCount: () => tree.getLineCount(),
        edit,
        batch(edits) {
          for (const change of edits.toSorted((a, b) => b.from - a.from || b.to - a.to))
            edit(change)
        },
        line: (row) => tree.getLineContent(row + 1),
        range,
        point(offset) {
          const position = tree.getPositionAt(offset)
          return { row: position.lineNumber - 1, column: position.column - 1 }
        },
        offset: (point) => tree.getOffsetAt(point.row + 1, point.column + 1),
        full: () => range(0, tree.getLength()),
        issues: () => [],
        stats: () => ({}),
      }
    },
  }
}

export function applyOperation(buffer: Buffer, operation: Operation) {
  if (operation.kind === 'edit') {
    buffer.edit(operation)
    return null
  }
  if (operation.kind === 'batch') {
    buffer.batch(operation.edits)
    return null
  }
  if (operation.kind === 'line') return buffer.line(operation.row)
  if (operation.kind === 'range') return buffer.range(operation.from, operation.to)
  if (operation.kind === 'offset') return buffer.point(operation.offset)
  if (operation.kind === 'point') return buffer.offset(operation.point)
  if (operation.kind === 'full') return buffer.full()
  throw new Error('Unknown operation')
}

type VscodeTree = {
  root: TreeNode | null
  getPositionAt(offset: number): { lineNumber: number; column: number }
  getOffsetAt(lineNumber: number, column: number): number
  getValueInRange(range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }): string
  insert(offset: number, text: string, normalized: boolean): void
  delete(offset: number, length: number): void
  getLength(): number
  getLineCount(): number
  getLineContent(line: number): string
}
