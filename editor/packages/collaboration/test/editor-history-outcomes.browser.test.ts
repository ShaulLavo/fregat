import { expect, test } from 'vitest'
import { EditorRoom } from './editor-fixture'
test('rejected authored undo restores the prior graph cursor', () => {
  const room = new EditorRoom(2, 'seed')
  try {
    const editor = room.editors[1]!
    editor.edit({ from: 4, to: 4, text: 'A' })
    room.flush()
    const buffer = editor.getBufferSession()!.buffer
    const before = buffer.getHistoryGraph().currentId
    editor.dispatchCommand('undo')
    const author = room.connections[1]!.document
    const command = author.participant.state().pending[0]!
    expect(command.change.kind).toBe('setEffects')
    const rejection = room.connections[0]!.document.sequence(command, 'probe rejection')
    expect(author.apply(rejection)).toBe(true)
    expect(room.texts()).toEqual(['seedA', 'seedA'])
    expect(buffer.getHistoryGraph().currentId).toBe(before)
  } finally {
    room.dispose()
  }
})

test('rejected local work preserves accepted branches and remains persistable', () => {
  const room = new EditorRoom(2, 'seed')
  try {
    const editor = room.editors[1]!
    const buffer = editor.getBufferSession()!.buffer
    editor.edit({ from: 4, to: 4, text: 'A' })
    room.flush()
    const accepted = buffer.getHistoryGraph().currentId
    buffer.breakTypingRun()
    editor.edit({ from: 5, to: 5, text: 'B' })
    const author = room.connections[1]!.document
    const pending = author.participant.state().pending[0]!
    const rejected = room.connections[0]!.document.sequence(pending, 'test rejection')
    expect(author.apply(rejected)).toBe(true)
    expect(buffer.getHistoryGraph().currentId).toBe(accepted)
    expect(buffer.getHistoryGraph().nodes).toHaveLength(2)
    const data = structuredClone(buffer.serializeHistory())!
    buffer.clearHistory()
    expect(buffer.restoreHistory(data)).toBe(true)
    editor.dispatchCommand('undo')
    room.flush()
    expect(room.texts()).toEqual(['seed', 'seed'])
  } finally {
    room.dispose()
  }
})

test('rejected branch checkout keeps both branches and the departing cursor', () => {
  const room = new EditorRoom(2, 'seed')
  try {
    const editor = room.editors[1]!
    const { buffer, view } = editor.getBufferSession()!
    editor.edit({ from: 4, to: 4, text: 'A' })
    room.flush()
    const a = buffer.getHistoryGraph().currentId
    editor.dispatchCommand('undo')
    room.flush()
    buffer.breakTypingRun()
    editor.edit({ from: 4, to: 4, text: 'B' })
    room.flush()
    const b = buffer.getHistoryGraph().currentId
    buffer.checkoutHistoryState(a, view)
    const author = room.connections[1]!.document
    const command = author.participant.state().pending[0]!
    const rejected = room.connections[0]!.document.sequence(command, 'test rejection')
    expect(author.apply(rejected)).toBe(true)
    expect(room.texts()).toEqual(['seedB', 'seedB'])
    expect(buffer.getHistoryGraph().currentId).toBe(b)
    expect(buffer.getHistoryGraph().nodes).toHaveLength(3)
    buffer.checkoutHistoryState(a, view)
    room.flush()
    expect(room.texts()).toEqual(['seedA', 'seedA'])
  } finally {
    room.dispose()
  }
})

test('partial group rejection retains its accepted operation and valid selection gaps', () => {
  const room = new EditorRoom(2, 'seed')
  try {
    const editor = room.editors[1]!
    const buffer = editor.getBufferSession()!.buffer
    editor.edit(
      [
        { from: 0, to: 0, text: 'A' },
        { from: 4, to: 4, text: 'B' },
      ],
      { selections: [{ anchor: 0 }, { anchor: 6 }] },
    )
    expect(buffer.getHistoryGraph().nodes).toHaveLength(2)
    const author = room.connections[1]!.document
    const [first, second] = author.participant.state().pending
    const confirmation = room.connections[0]!.document.sequence(first!)
    const expected = room.connections[0]!.document.engine.text()
    expect(author.apply(confirmation)).toBe(true)
    expect(author.apply(room.connections[0]!.document.sequence(second!, 'test rejection'))).toBe(
      true,
    )
    expect(room.texts()).toEqual([expected, expected])
    const data = structuredClone(buffer.serializeHistory())!
    buffer.clearHistory()
    expect(buffer.restoreHistory(data)).toBe(true)
    editor.dispatchCommand('undo')
    room.flush()
    expect(room.texts()).toEqual(['seed', 'seed'])
  } finally {
    room.dispose()
  }
})
