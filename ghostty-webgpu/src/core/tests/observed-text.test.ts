import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrameObserver } from '../../render/frame-observer.js'
import { observeDisplayedFrame, type DisplayedTextFrame } from '../../render/displayed-frame.js'
import { GhosttyRuntime } from '../runtime.js'

let runtime: GhosttyRuntime | undefined

afterEach(() => {
  vi.restoreAllMocks()
  runtime?.dispose()
  runtime = undefined
})

async function observedTerminal() {
  runtime = await GhosttyRuntime.create()
  const terminal = runtime.createTerminal({ columns: 16, rows: 3 })
  const state = runtime.createRenderState(terminal)
  const frames: DisplayedTextFrame[] = []
  let reader = true
  const observer = new FrameObserver({
    rows: 3,
    retainDisplayedText: true,
    needsFrameRows: () => reader,
    [observeDisplayedFrame]: (frame) => frames.push(frame),
  })
  const publish = (changed: readonly number[] = [0, 1, 2]) => {
    state.update()
    const prepared = observer.capture(state, state.readCursor(), undefined, changed)
    state.acknowledge()
    prepared.accept()
    prepared.notify()
    return frames.at(-1)!
  }
  return {
    terminal,
    state,
    observer,
    frames,
    publish,
    setReader: (enabled: boolean) => (reader = enabled),
  }
}

function text(frame: DisplayedTextFrame) {
  return frame.rows.map((row) => ({ y: row.y, text: row.text }))
}

describe('accepted copied text publication', () => {
  it('reuses accepted rows without a previous native text extraction', async () => {
    const { terminal, publish } = await observedTerminal()
    terminal.write('first\r\n界 é 🧑‍💻\r\nthird')
    const first = publish()
    const readPrevious = vi.spyOn(runtime!.bridge, 'readRetainedText')
    terminal.write('\x1b[1;1Hnext ')
    const second = publish([0])
    expect(readPrevious).not.toHaveBeenCalled()
    expect(second.previousTextRows).toEqual(first.rows)
    expect(second.previousTextRows?.[1]).toBe(first.rows[1])
    expect(second.rows[1]).toBe(first.rows[1])
    expect(second.rows[0]?.text).toContain('next')
  })

  it('keeps unrelated rows after sparse and empty independent reads', async () => {
    const { terminal, state, publish } = await observedTerminal()
    terminal.write('first\r\nsecond 界\r\nthird é')
    const first = publish()
    state.readTextRows({ rows: new Set([1]) })
    state.readTextRows({ rows: new Set() })
    terminal.write('\x1b[2;1Hchanged')
    const sparse = publish([1])
    expect(sparse.rows[0]).toBe(first.rows[0])
    expect(sparse.rows[2]).toBe(first.rows[2])
    const empty = publish([])
    for (let y = 0; y < 3; y += 1) expect(empty.rows[y]).toBe(sparse.rows[y])
  })

  it('reads staged previous text when a reader starts after idle frames', async () => {
    const { terminal, state, publish, setReader } = await observedTerminal()
    setReader(false)
    const readCurrent = vi.spyOn(state, 'readTextRows')
    terminal.write('idle first\r\nold 界 é\r\nlast')
    publish()
    terminal.write('\x1b[1;1Hidle next ')
    publish()
    expect(readCurrent).not.toHaveBeenCalled()
    const readPrevious = vi.spyOn(runtime!.bridge, 'readRetainedText')
    setReader(true)
    terminal.write('\x1b[2;1Hnew 🧑‍💻')
    const active = publish([1])
    expect(readPrevious).toHaveBeenCalled()
    expect(active.previousTextRows?.[1]?.text).toContain('old 界 é')
    expect(active.rows[1]?.text).toContain('new 🧑‍💻')
    readPrevious.mockClear()
    terminal.write('\x1b[3;1Hnext')
    const next = publish([2])
    expect(readPrevious).not.toHaveBeenCalled()
    expect(next.previousTextRows?.[1]).toBe(active.rows[1])
  })

  it('leaves accepted rows intact when a staged frame is discarded', async () => {
    const { terminal, state, observer, frames, publish } = await observedTerminal()
    terminal.write('accepted 界 é')
    const first = publish()
    terminal.write('\x1b[2J\x1b[Hunpainted')
    state.update()
    const abandoned = observer.capture(state, state.readCursor(), undefined, [0, 1, 2])
    abandoned.discard()
    abandoned.notify()
    expect(frames).toHaveLength(1)
    terminal.write('\x1b[2J\x1b[Hdisplayed')
    const next = publish()
    expect(next.previousTextRows).toEqual(first.rows)
    expect(next.rows[0]?.text).toContain('displayed')
    expect(text(next).every((row) => !row.text.includes('unpainted'))).toBe(true)
  })

  it('publishes exact text across wrap, scroll, resize and clear', async () => {
    const { terminal, state, observer, publish } = await observedTerminal()
    const held = []
    for (const value of [
      'first 界 é 🧑‍💻 wraps across the edge',
      '\r\nsecond\r\nthird\r\nfourth 界',
      '\x1b[2J\x1b[Hclear then é',
    ]) {
      terminal.write(value)
      const frame = publish()
      const expected = state.readTextRows().map((row) => ({ y: row.y, text: row.text }))
      expect(text(frame)).toEqual(expected)
      held.push({ rows: frame.rows, expected })
    }
    terminal.resize({ columns: 11, rows: 5 })
    observer.resize(5)
    terminal.write('\x1b[2J\x1b[Hresized 界 é 🧑‍💻')
    const resized = publish([0, 1, 2, 3, 4])
    expect(text(resized)).toEqual(state.readTextRows().map((row) => ({ y: row.y, text: row.text })))
    terminal.clear()
    const cleared = publish([0, 1, 2, 3, 4])
    expect(text(cleared)).toEqual(state.readTextRows().map((row) => ({ y: row.y, text: row.text })))
    for (const snapshot of held)
      expect(snapshot.rows.map((row) => ({ y: row.y, text: row.text }))).toEqual(snapshot.expected)
  })
})
