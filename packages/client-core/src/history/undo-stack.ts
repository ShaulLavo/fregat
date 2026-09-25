export type HistoryDirection = 'undo' | 'redo'
export type UndoStack<Entry> = Readonly<Record<HistoryDirection, readonly Entry[]>>

export function emptyUndoStack<Entry>(): UndoStack<Entry> {
  return { undo: [], redo: [] }
}

export function pushUndo<Entry>(
  stack: UndoStack<Entry>,
  entry: Entry,
  limit = 50,
): UndoStack<Entry> {
  return { undo: [...stack.undo, entry].slice(-limit), redo: [] }
}

export function takeHistory<Entry>(stack: UndoStack<Entry>, direction: HistoryDirection) {
  return {
    entry: stack[direction].at(-1),
    stack: { ...stack, [direction]: stack[direction].slice(0, -1) },
  }
}

export function finishHistory<Entry>(
  stack: UndoStack<Entry>,
  direction: HistoryDirection,
  inverse: Entry,
): UndoStack<Entry> {
  const other = direction === 'undo' ? 'redo' : 'undo'
  return { ...stack, [other]: [...stack[other], inverse] }
}
