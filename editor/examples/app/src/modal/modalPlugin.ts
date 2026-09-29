import {
  nextWordOffset,
  previousWordOffset,
  wordRangeAtOffset,
  type TextEdit,
} from '@singapore-editor/core/document'
import type { Editor } from '@singapore-editor/core/editor'
import {
  createPlugin,
  documentInput,
  type EditorPlugin,
  type EditorViewScope,
} from '@singapore-editor/core/extensions'
import {
  modalHandles,
  modalStep,
  NORMAL,
  type ModalAction,
  type ModalMotion,
  type ModalState,
} from './grammar'

// How far a word motion looks for the next word; a longer run of whitespace stops there.
const WORD_WINDOW = 4096

/**
 * A bounded modal editing proof built only on public exports (Editor E028): normal and insert
 * modes, h j k l w b 0 $, counts, d with a motion, dd, diw, Escape and u.
 */
export function createModalEditingPlugin(): EditorPlugin {
  return createPlugin({
    name: 'example.modal',
    view(scope) {
      const mode = scope.state<ModalState>(NORMAL)
      // A new document, or focus leaving the view, drops a half-typed command; the mode stays.
      const cancelPending = () => {
        if (mode.get().kind === 'normal') mode.set(NORMAL)
      }
      scope.watch(documentInput, () => cancelPending())
      scope.keyParticipant((event) => {
        if (!modalHandles(mode.get(), event.key)) return 'delegate'
        const step = modalStep(mode.get(), event.key)
        mode.set(step.state)
        run(scope, step.action)
        return 'consume'
      })
      scope.textGate(() => mode.get().kind === 'insert')
      scope.watch(mode.input, (state) => {
        scope.cursorStyle(state.kind === 'insert' ? 'line' : 'block')
        scope.view.container.dataset.modalMode = state.kind
      })
      scope.view.container.addEventListener('focusout', cancelPending)
      scope.onDispose(() => {
        scope.view.container.removeEventListener('focusout', cancelPending)
        delete scope.view.container.dataset.modalMode
      })
    },
  })
}

function run(scope: EditorViewScope, action: ModalAction): void {
  if (action.kind === 'undo') {
    ;(scope.editor as Editor).dispatchCommand('undo')
    return
  }
  if (action.kind === 'insert') {
    if (action.after) moveCarets(scope, (offset) => motionTarget(scope, offset, 'l', 1))
    return
  }
  if (action.kind === 'move') {
    moveCarets(scope, (offset) => motionTarget(scope, offset, action.motion, action.count))
    return
  }
  if (action.kind === 'delete') {
    deleteRanges(scope, (offset) => motionRange(scope, offset, action.motion, action.count))
    return
  }
  if (action.kind === 'deleteLines') {
    deleteRanges(scope, (offset) => lineRange(scope, offset, action.count))
    return
  }
  if (action.kind === 'deleteInnerWord') deleteRanges(scope, (offset) => innerWord(scope, offset))
}

function carets(scope: EditorViewScope): readonly number[] {
  return scope.getSelections().map((selection) => selection.headOffset)
}

function moveCarets(scope: EditorViewScope, target: (offset: number) => number): void {
  const next = carets(scope).map((offset) => {
    const head = target(offset)
    return { anchor: head, head }
  })
  scope.view.setSelections(next, 'example.modal.move', next[0]?.head)
}

type Range = { readonly start: number; readonly end: number }

// One batch against one snapshot: overlapping ranges from several carets merge first, so the
// command is one undo entry and each caret lands where its text went.
function deleteRanges(scope: EditorViewScope, rangeFor: (offset: number) => Range): void {
  const ranges = mergeRanges(carets(scope).map(rangeFor))
  if (ranges.length === 0) return
  const edits: TextEdit[] = ranges.map((range) => ({ from: range.start, to: range.end, text: '' }))
  let removed = 0
  const selections = ranges.map((range) => {
    const at = range.start - removed
    removed += range.end - range.start
    return { anchor: at, head: at }
  })
  scope.applyEdits(edits, selections)
}

function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .toSorted((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) }
      continue
    }
    merged.push(range)
  }
  return merged
}

function text(scope: EditorViewScope) {
  return scope.view.getSnapshot().textSnapshot
}

function motionTarget(
  scope: EditorViewScope,
  offset: number,
  motion: ModalMotion,
  count: number,
): number {
  let target = offset
  for (let step = 0; step < count; step += 1) target = motionOnce(scope, target, motion)
  return target
}

function motionOnce(scope: EditorViewScope, offset: number, motion: ModalMotion): number {
  const source = text(scope)
  const line = source.lineAt(offset)
  const range = source.lineRange(line)
  if (motion === '0') return range.start
  if (motion === '$') return range.end
  if (motion === 'h')
    return Math.max(range.start, offset - graphemeBefore(scope, offset, range.start))
  if (motion === 'l') return Math.min(range.end, offset + graphemeAfter(scope, offset, range.end))
  if (motion === 'j' || motion === 'k') return verticalTarget(scope, offset, motion)
  if (motion === 'w') {
    const end = Math.min(source.length, offset + WORD_WINDOW)
    return offset + nextWordOffset(source.readRange(offset, end), 0)
  }
  const start = Math.max(0, offset - WORD_WINDOW)
  return start + previousWordOffset(source.readRange(start, offset), offset - start)
}

function verticalTarget(scope: EditorViewScope, offset: number, motion: 'j' | 'k'): number {
  const source = text(scope)
  const line = source.lineAt(offset)
  const target = motion === 'j' ? line + 1 : line - 1
  if (target < 0 || target >= source.lineCount) return offset
  const column = offset - source.lineStart(line)
  const range = source.lineRange(target)
  return Math.min(range.end, range.start + column)
}

function graphemeAfter(scope: EditorViewScope, offset: number, lineEnd: number): number {
  const chunk = text(scope).readRange(offset, Math.min(lineEnd, offset + 32))
  const first = segments(chunk)[0]
  return first?.length ?? 0
}

function graphemeBefore(scope: EditorViewScope, offset: number, lineStart: number): number {
  const chunk = text(scope).readRange(Math.max(lineStart, offset - 32), offset)
  const last = segments(chunk).at(-1)
  return last?.length ?? 0
}

function segments(chunk: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return [...segmenter.segment(chunk)].map((entry) => entry.segment)
}

function motionRange(
  scope: EditorViewScope,
  offset: number,
  motion: ModalMotion,
  count: number,
): Range {
  // `dj` and `dk` take whole lines, the lines the motion spans.
  if (motion === 'j' || motion === 'k') {
    const source = text(scope)
    const line = source.lineAt(offset)
    const first = motion === 'j' ? line : Math.max(0, line - count)
    return linesRange(scope, first, count + 1)
  }
  const target = motionTarget(scope, offset, motion, count)
  return { start: Math.min(offset, target), end: Math.max(offset, target) }
}

function lineRange(scope: EditorViewScope, offset: number, count: number): Range {
  return linesRange(scope, text(scope).lineAt(offset), count)
}

// Whole lines with their break: the one after them, or the one before the last line.
function linesRange(scope: EditorViewScope, first: number, count: number): Range {
  const source = text(scope)
  const last = Math.min(source.lineCount - 1, first + count - 1)
  const start = source.lineStart(first)
  const end = source.lineRange(last).end
  if (last + 1 < source.lineCount) return { start, end: source.lineStart(last + 1) }
  return { start: first > 0 ? source.lineRange(first - 1).end : start, end }
}

function innerWord(scope: EditorViewScope, offset: number): Range {
  const source = text(scope)
  const range = source.lineRange(source.lineAt(offset))
  const word = wordRangeAtOffset(source.readRange(range.start, range.end), offset - range.start)
  return { start: range.start + word.start, end: range.start + word.end }
}
