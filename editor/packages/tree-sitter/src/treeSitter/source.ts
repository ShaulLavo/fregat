import type { DocumentWorkerRead } from '@singapore-editor/core/internal/document-worker'

export const TREE_SITTER_BOOTSTRAP_UNITS = 65_536

export type TreeSitterPieceTableInput = {
  readonly read: DocumentWorkerRead
  readonly length: number
  retain(): TreeSitterPieceTableInput
  dispose(): void
}

// web-tree-sitter copies callback text into a fixed 10KB UTF-16 buffer.
const PARSER_READ_BATCH_CODE_UNITS = 4096

// Cached parser trees keep the request's text callback until their source retires.
export function createTreeSitterInput(read: DocumentWorkerRead): TreeSitterPieceTableInput {
  return inputHandle({ read, owners: 1 })
}

function inputHandle(shared: {
  readonly read: DocumentWorkerRead
  owners: number
}): TreeSitterPieceTableInput {
  let disposed = false
  return {
    read: shared.read,
    length: shared.read.text.length,
    retain() {
      if (disposed || !shared.read.isValid())
        throw new DOMException('Document source scope was released', 'AbortError')
      shared.owners++
      return inputHandle(shared)
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (--shared.owners === 0) shared.read.dispose()
    },
  }
}

export function readTreeSitterPieceTableInput(
  input: TreeSitterPieceTableInput,
  index: number,
  endIndex?: number,
): string | undefined {
  assertSource(input)
  if (index < 0 || index >= input.length) return undefined
  const end = Math.min(input.length, index + PARSER_READ_BATCH_CODE_UNITS, endIndex ?? input.length)
  if (end <= index) return ''
  const text = input.read.text.readRange(index, end)
  if (end === endIndex || end === input.length || text.length <= 1) return text
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text
}

export function readTreeSitterInputRange(
  input: TreeSitterPieceTableInput,
  startIndex: number,
  endIndex: number,
): string {
  assertSource(input)
  return input.read.text.readRange(startIndex, endIndex)
}

function assertSource(input: TreeSitterPieceTableInput): void {
  if (!input.read.isValid())
    throw new DOMException('Document source scope was released', 'AbortError')
}

export function limitTreeSitterInput(
  source: TreeSitterPieceTableInput,
  length: number,
): TreeSitterPieceTableInput {
  const owner = source.retain()
  return {
    read: owner.read,
    length: Math.min(length, source.length),
    retain: () => limitTreeSitterInput(owner, length),
    dispose: () => owner.dispose(),
  }
}
