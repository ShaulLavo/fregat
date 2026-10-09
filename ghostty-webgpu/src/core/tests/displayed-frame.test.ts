import { retainDisplayedFrame } from '../../render/displayed-frame.js'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalSession } from '../../term/session.js'
import { DisplayedFrameStore } from '../displayed-frame.js'
import { GhosttyRuntime } from '../runtime.js'
import type { GhosttyRenderState } from '../render-state.js'

let runtime: GhosttyRuntime | undefined

afterEach(() => {
  runtime?.dispose()
  runtime = undefined
})

function handles(state: GhosttyRenderState) {
  return ['state', 'iterator', 'cells'].map(
    (key) => (Reflect.get(state, key) as { handle: number }).handle,
  ) as [number, number, number]
}

function serialized(value: unknown): string {
  return JSON.stringify(value)
}

describe('retained native displayed frame', () => {
  it.each([
    'ASCII text\r\nsecond row',
    '界 é 🧑‍💻 ☕️\r\n👩‍👩‍👧‍👦',
    '\u001b[1;3;4;38;2;12;34;56;48;5;26mstyle\u001b[0m plain\r\n\u001b[48;2;91;82;73m\u001b[K',
    '\u001b[8mconcealed\u001b[0m\r\n\u001b[2;5;7;9;53mflags\u001b[0m',
  ])('matches pushed text bytes and retained styled cells for %j', async (output) => {
    runtime = await GhosttyRuntime.create()
    const terminal = runtime.createTerminal({ columns: 30, rows: 4 })
    const state = runtime.createRenderState(terminal)
    terminal.write(output)
    state.update()
    const pushed = serialized(state.readTextRows())
    const styles = serialized(state.readRows().map(({ dirty: _dirty, ...row }) => row))
    const displayed = state[retainDisplayedFrame]()
    expect(serialized(displayed.readTextRows())).toBe(pushed)
    expect(serialized(displayed.readRows().map(({ dirty: _dirty, ...row }) => row))).toBe(styles)
    expect(displayed.readTextRows({ rows: new Set([1]) })).toEqual(
      state.readTextRows({ rows: new Set([1]) }),
    )
  })

  it('retains selected cells after native selection is cleared', async () => {
    runtime = await GhosttyRuntime.create()
    const session = await TerminalSession.create<Event>({
      runtime: { kind: 'borrowed', runtime },
      appearance: { grid: { columns: 16, rows: 3 } },
    })
    try {
      session.write('selected text')
      session.selectRange({ x: 1, y: 0 }, { x: 7, y: 0 })
      session.renderState.update()
      const rows = session.renderState.readRows()
      expect(rows[0]?.cells.some((cell) => cell.selected)).toBe(true)
      const expected = serialized(rows.map(({ dirty: _dirty, ...row }) => row))
      const displayed = (session.renderState as GhosttyRenderState)[retainDisplayedFrame]!()
      session.clearSelection()
      session.renderState.update()
      expect(serialized(displayed.readRows().map(({ dirty: _dirty, ...row }) => row))).toBe(
        expected,
      )
    } finally {
      session.dispose()
    }
  })

  it('keeps displayed bytes through newer native updates, resize, and WASM memory growth', async () => {
    runtime = await GhosttyRuntime.create()
    const terminal = runtime.createTerminal({ columns: 16, rows: 3 })
    const state = runtime.createRenderState(terminal)
    terminal.write('displayed 界')
    state.update()
    const pushed = serialized(state.readTextRows())
    const displayed = state[retainDisplayedFrame]()
    terminal.write('\rnew native state')
    state.update()
    expect(serialized(state.readTextRows())).not.toBe(pushed)
    runtime.exports.memory.grow(1)
    expect(serialized(displayed.readTextRows())).toBe(pushed)
    terminal.resize({ columns: 20, rows: 4 })
    state.update()
    expect(serialized(displayed.readTextRows())).toBe(pushed)
    const owned = displayed.readTextRows()
    const resized = state[retainDisplayedFrame]()
    expect(resized.readTextRows()).toHaveLength(4)
    expect(resized.readTextRows()[0]?.cells).toHaveLength(20)
    expect(serialized(resized.readPreviousTextRows())).toBe(pushed)
    expect(() => displayed.readTextRows()).toThrow('token has retired')
    state.dispose()
    expect(serialized(owned)).toBe(pushed)
    expect(() => resized.readTextRows()).toThrow('token has retired')
  })

  it('preserves both displayed generations when a native retention capture fails and disposes twice', async () => {
    runtime = await GhosttyRuntime.create()
    const terminal = runtime.createTerminal({ columns: 12, rows: 2 })
    const state = runtime.createRenderState(terminal)
    const store = new DisplayedFrameStore(runtime)
    try {
      terminal.write('first')
      state.update()
      const first = store.capture(...handles(state), { columns: 12, rows: 2 })
      const firstBytes = serialized(first.readTextRows())
      terminal.write('\rsecond')
      state.update()
      const second = store.capture(...handles(state), { columns: 12, rows: 2 })
      const secondBytes = serialized(second.readTextRows())
      terminal.write('\rfailed third')
      state.update()
      expect(() => store.capture(...handles(state), { columns: 11, rows: 2 })).toThrow()
      expect(serialized(second.readTextRows())).toBe(secondBytes)
      expect(serialized(second.readPreviousTextRows())).toBe(firstBytes)
      store.dispose()
      store.dispose()
      expect(() => store.capture(...handles(state), { columns: 12, rows: 2 })).toThrow('disposed')
    } finally {
      store.dispose()
    }
  })
})
