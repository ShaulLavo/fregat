import type { DocumentWorkerRead } from '@singapore-editor/core/internal/document-worker'

export type TreeSitterPieceTableInput = {
  readonly read: DocumentWorkerRead
  readonly length: number
  retain(): TreeSitterPieceTableInput
  dispose(): void
}

// web-tree-sitter copies callback text into a fixed 10KB UTF-16 buffer.
const PARSER_READ_BATCH_CODE_UNITS = 4096

export function createTreeSitterInput(read: DocumentWorkerRead): TreeSitterPieceTableInput {
  return {
    read,
    length: read.text.length,
    retain() {
      const retained = read.retain()
      if (!retained) throw new DOMException('Document source scope was released', 'AbortError')
      return createTreeSitterInput(retained)
    },
    dispose: () => read.dispose(),
  }
}

export function readTreeSitterPieceTableInput(
  input: TreeSitterPieceTableInput,
  index: number,
): string | undefined {
  assertSource(input)
  if (index < 0 || index >= input.length) return undefined
  const end = Math.min(input.length, index + PARSER_READ_BATCH_CODE_UNITS)
  const text = input.read.text.readRange(index, end)
  if (end === input.length || text.length <= 1) return text
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
