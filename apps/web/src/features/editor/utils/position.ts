import type { TextSnapshot } from '@singapore-editor/core/document'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'

export function selectionForDefinition(
  filePath: string,
  textSnapshot: TextSnapshot,
  target: LanguageServerDefinitionTarget | null | undefined,
) {
  if (!target) return null
  if (target.path !== filePath) return null

  const anchor = offsetForPosition(textSnapshot, target.range.start)
  const head = offsetForPosition(textSnapshot, target.range.end)
  return { anchor, head }
}

export function rowStartOffset(textSnapshot: TextSnapshot, row: number) {
  if (row <= 0) return 0

  const state = { remainingRows: row, result: null as number | null }
  textSnapshot.forEachTextChunk((text, start) => {
    if (state.result !== null) return

    visitRowStartChunk(state, text, start)
  })

  return state.result ?? textSnapshot.length
}

export function textLineAt(textSnapshot: TextSnapshot, lineIndex: number) {
  if (lineIndex < 0) return null

  const state = {
    remainingLines: lineIndex,
    lineStart: 0,
    result: null as string | null,
  }
  textSnapshot.forEachTextChunk((text, start) => {
    if (state.result !== null) return

    visitLineChunk(state, textSnapshot, text, start)
  })

  if (state.result !== null) return state.result
  if (state.remainingLines !== 0) return null

  return textSnapshot.readRange(state.lineStart, textSnapshot.length)
}

function offsetForPosition(
  textSnapshot: TextSnapshot,
  position: LanguageServerDefinitionTarget['range']['start'],
) {
  const lineStart = rowStartOffset(textSnapshot, position.line)
  return Math.min(textSnapshot.length, lineStart + position.character)
}

function visitRowStartChunk(
  state: { remainingRows: number; result: number | null },
  text: string,
  start: number,
) {
  let offset = 0
  while (offset < text.length) {
    const nextLine = text.indexOf('\n', offset)
    if (nextLine === -1) return

    state.remainingRows -= 1
    if (state.remainingRows === 0) {
      state.result = start + nextLine + 1
      return
    }

    offset = nextLine + 1
  }
}

function visitLineChunk(
  state: {
    remainingLines: number
    lineStart: number
    result: string | null
  },
  textSnapshot: TextSnapshot,
  text: string,
  start: number,
) {
  let offset = 0
  while (offset < text.length) {
    const nextLine = text.indexOf('\n', offset)
    if (nextLine === -1) return

    if (state.remainingLines === 0) {
      state.result = textSnapshot.readRange(state.lineStart, start + nextLine).replace(/\r$/u, '')
      return
    }

    state.remainingLines -= 1
    state.lineStart = start + nextLine + 1
    offset = nextLine + 1
  }
}
