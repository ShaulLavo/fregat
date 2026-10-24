import {
  arrayLspLineStarts,
  type LspTextDocumentSnapshot,
  type LspTextSnapshot,
} from '@singapore-editor/lsp'

/** A document read only a row at a time, so a test fails if a path rescans it. */
export function snapshotDocument(text: string): LspTextDocumentSnapshot {
  return {
    textSnapshot: throwingFullTextSnapshot(text),
    lineStarts: arrayLspLineStarts(lineStartsOf(text)),
  }
}

/** A document read freely, for a path whose job is a range as wide as the document. */
export function textDocument(text: string): LspTextDocumentSnapshot {
  return {
    textSnapshot: {
      length: text.length,
      readRange: (start, end) => text.slice(start, end),
      forEachTextChunk: (visit) => visit(text, 0, text.length),
    },
    lineStarts: arrayLspLineStarts(lineStartsOf(text)),
  }
}

function throwingFullTextSnapshot(text: string): LspTextSnapshot {
  return {
    length: text.length,
    // Every read the plugin makes stays inside one row, its break included, so crossing a row
    // boundary is how a whole-document read shows itself in a small fixture.
    readRange: (start, end) => {
      const read = text.slice(start, end)
      const lineBreak = read.indexOf('\n')
      if (lineBreak !== -1 && lineBreak < read.length - 1) {
        throw new Error('unexpected multi-row read')
      }
      return read
    },
    forEachTextChunk: () => {
      throw new Error('unexpected full text scan')
    },
  }
}

function lineStartsOf(text: string): number[] {
  const starts = [0]
  let index = text.indexOf('\n')

  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf('\n', index + 1)
  }

  return starts
}
