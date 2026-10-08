import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { GhosttyRuntime } from '../runtime.js'
import type { RenderTextRow } from '../types.js'

let runtime: GhosttyRuntime | undefined

afterEach(() => {
  runtime?.dispose()
  runtime = undefined
})

function materialize(rows: readonly RenderTextRow[]) {
  return rows.map(({ y, text, cells, continuations }) => ({ y, text, cells, continuations }))
}

async function fixture() {
  runtime = await GhosttyRuntime.create()
  const terminal = runtime.createTerminal({ columns: 40, rows: 12 })
  const state = runtime.createRenderState(terminal)
  const read = runtime.bridge.readTextRows.bind(runtime.bridge)
  const extracted: number[] = []
  runtime.bridge.readTextRows = (...args) => {
    const result = read(...args)
    extracted.push(runtime!.memory.view.getUint32(args[6] + 20, true) / 40)
    return result
  }
  const capture = () => {
    state.update()
    const rows = state.readTextRows()
    const expected = state.readRows().map(({ y, cells }) => ({
      y,
      text: cells.map((cell) => (cell.continuation ? '' : cell.text || ' ')).join(''),
      cells: cells.map((cell) => cell.text),
      continuations: cells.map((cell) => cell.continuation),
    }))
    expect(materialize(rows)).toEqual(expected)
    state.acknowledge()
    return rows
  }
  return { terminal, state, capture, extracted }
}

describe('owned text row reuse', () => {
  it.each(['plain', '日本語 中文 é café 🧪 👩‍💻'])(
    'extracts only new rows while scrolling %s',
    async (text) => {
      const { terminal, capture, extracted } = await fixture()
      for (let index = 0; index < 12; index += 1)
        terminal.write(`${index.toString().padStart(4, '0')} ${text}\r\n`)
      const first = capture()
      const held = materialize(first)
      terminal.write(`0012 ${text}\r\n`)
      const second = capture()
      expect(extracted.at(-1)).toBe(2)
      expect(second[0]!.cells).toBe(first[1]!.cells)
      expect(second[0]!.continuations).toBe(first[1]!.continuations)
      terminal.resize({ columns: 19, rows: 4 })
      capture()
      runtime!.exports.memory.grow(1)
      runtime!.dispose()
      expect(materialize(first)).toEqual(held)
      expect(structuredClone(first)).toEqual(held)
    },
  )

  it('captures scroll-region movement and an in-place edit of a moved row', async () => {
    const { terminal, capture } = await fixture()
    for (let index = 0; index < 12; index += 1)
      terminal.write(`\x1b[${index + 1};1Hrow ${index} 界é`)
    const first = capture()
    terminal.write('\x1b[3;10r\x1b[10;1H\n\x1b[4;1HEDIT 👩‍💻')
    const second = capture()
    expect(second[2]!.cells).toEqual(first[3]!.cells)
    expect(second[3]!.cells).not.toBe(first[4]!.cells)
  })

  it('detects a changed grapheme on a row moved by a full-screen scroll', async () => {
    const { terminal, capture, extracted } = await fixture()
    for (let index = 0; index < 12; index += 1)
      terminal.write(`${index.toString().padStart(4, '0')} é 界\r\n`)
    const first = capture()
    terminal.write('0012 é 界\r\n\x1b[1;6Hè')
    const second = capture()
    expect(second[0]!.text).toContain('0002 è')
    expect(second[0]!.cells).not.toBe(first[1]!.cells)
    expect(second[1]!.cells).toBe(first[2]!.cells)
    expect(extracted.at(-1)).toBe(3)
  })

  it('preserves empty cells, literal spaces, wide tails and graphemes through screen and history changes', async () => {
    const { terminal, capture } = await fixture()
    terminal.write('\x1b[?2027h\x1b[H  \x1b[1;33H界é\x1b[2;1H👩‍💻a' + '́'.repeat(80))
    const first = capture()
    const held = materialize(first)
    for (const sequence of [
      '\x1b[1;1H\x1b[2P',
      '\x1b[2;1H👨‍💻a' + '̀'.repeat(80),
      '\x1b[?1049h\x1b[Halternate 界é',
      '\x1b[?1049l',
      '\x1b[12;1H\r\nnew\r\nmore\r\nlast',
    ]) {
      terminal.write(sequence)
      capture()
    }
    terminal.scrollToTop()
    capture()
    terminal.scrollToBottom()
    capture()
    expect(materialize(first)).toEqual(held)
  })

  it('retries a fresh grapheme row without committing moved payloads early', async () => {
    const { terminal, capture, extracted } = await fixture()
    for (let index = 0; index < 12; index += 1)
      terminal.write(`${index.toString().padStart(4, '0')} plain\r\n`)
    const first = capture()
    const held = materialize(first)
    const calls = extracted.length
    terminal.write('0012 plain\r\n\x1b[1;6He' + '́'.repeat(400))
    const second = capture()
    expect(extracted.slice(calls)).toEqual([3, 3])
    expect(second[0]!.cells).not.toBe(first[1]!.cells)
    expect(second[1]!.cells).toBe(first[2]!.cells)
    expect(materialize(first)).toEqual(held)
  })

  it('owns lazy moved payloads through repeated scrolling and worker delivery after disposal', async () => {
    const { terminal, state } = await fixture()
    terminal.write('\x1b[?2027h')
    for (let index = 0; index < 12; index += 1) terminal.write(`${index} 界é 👩‍💻\r\n`)
    state.update()
    state.readTextRows()
    state.acknowledge()
    terminal.write('12 界é 👩‍💻\r\n')
    state.update()
    const held = state.readTextRows()
    const expected = state.readRows().map(({ y, cells }) => ({
      y,
      text: cells.map((cell) => (cell.continuation ? '' : cell.text || ' ')).join(''),
      cells: cells.map((cell) => cell.text),
      continuations: cells.map((cell) => cell.continuation),
    }))
    state.acknowledge()
    for (let index = 13; index < 113; index += 1) {
      terminal.write(`${index} 界é 👩‍💻\r\n`)
      state.update()
      state.readTextRows()
      state.acknowledge()
    }
    terminal.resize({ columns: 20, rows: 4 })
    state.update()
    state.readTextRows()
    runtime!.exports.memory.grow(1)
    runtime!.dispose()
    const { port1, port2 } = new MessageChannel()
    try {
      const delivered = once(port2, 'message')
      port1.postMessage(held)
      expect((await delivered)[0]).toEqual(expected)
      expect(materialize(held)).toEqual(expected)
    } finally {
      port1.close()
      port2.close()
    }
  })

  it('keeps sparse reads current without losing unchanged payloads', async () => {
    const { terminal, state, capture } = await fixture()
    terminal.write('first\r\nsecond\r\nthird')
    const first = capture()
    const sparse = state.readTextRows({ rows: new Set([1]) })
    expect(sparse[0]!.cells).toBe(first[1]!.cells)
    terminal.write('\x1b[2;1Hchanged')
    state.update()
    const changed = state.readTextRows({ rows: new Set([1]), dirtyOnly: true })
    expect(changed[0]!.text).toContain('changed')
    expect(changed[0]!.cells).not.toBe(first[1]!.cells)
    expect(materialize(state.readTextRows())).toEqual(materialize(capture()))
  })
})
