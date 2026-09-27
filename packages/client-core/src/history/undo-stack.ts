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

/** Takes the newest entry, or the newest one `pick` accepts. */
export function takeHistory<Entry>(
  stack: UndoStack<Entry>,
  direction: HistoryDirection,
  pick: (entry: Entry) => boolean = () => true,
) {
  const index = stack[direction].findLastIndex(pick)
  if (index < 0) return { entry: undefined, stack }
  return {
    entry: stack[direction][index],
    stack: { ...stack, [direction]: stack[direction].toSpliced(index, 1) },
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
