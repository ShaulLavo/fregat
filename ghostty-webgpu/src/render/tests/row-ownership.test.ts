import { setImmediate } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { GhosttyRuntime } from '../../core/runtime.js'
import type { RenderRow } from '../../core/types.js'
import type {
  RendererFrameSnapshot,
  RendererTextFrameSnapshot,
  RendererTextFrameRow,
} from '../renderer.js'
import { FrameObserver } from '../frame-observer.js'

type Source = 'full' | 'paint-text' | 'native-text' | 'ascii-text'
const sources: Source[] = ['full', 'paint-text', 'native-text', 'ascii-text']
const grid = { columns: 40, rows: 100 }

setFlagsFromString('--expose-gc')
const collect: () => void = runInNewContext('gc')

function observePayload() {
  const references: WeakRef<ArrayBufferLike>[] = []
  const Constructor = Uint32Array
  const slice = Constructor.prototype.slice
  Constructor.prototype.slice = function (start?: number, end?: number) {
    const result = slice.call(this, start, end)
    references.push(new WeakRef(result.buffer))
    return result
  }
  globalThis.Uint32Array = new Proxy(Constructor, {
    construct(target, args, newTarget) {
      const result = Reflect.construct(target, args, newTarget) as Uint32Array
      if (typeof args[0] === 'number') references.push(new WeakRef(result.buffer))
      return result
    },
  })
  return {
    restore() {
      globalThis.Uint32Array = Constructor
      Constructor.prototype.slice = slice
    },
    async bytes() {
      // WeakRef targets survive their creation/deref job; collect on separate event-loop turns.
      for (let turn = 0; turn < 3; turn += 1) {
        await setImmediate()
        collect()
      }
      const buffers = new Set<ArrayBufferLike>()
      for (const reference of references) {
        const buffer = reference.deref()
        if (buffer) buffers.add(buffer)
      }
      let bytes = 0
      for (const buffer of buffers) bytes += buffer.byteLength
      return bytes
    },
  }
}

function expectFrozenRows(rows: readonly RendererTextFrameRow[]): void {
  for (const row of rows) {
    expect(Object.isFrozen(row)).toBe(true)
    expect(Object.isFrozen(row.cells)).toBe(true)
    expect(Object.isFrozen(row.continuations)).toBe(true)
  }
}

function rowText(source: Source, y: number, revision: number): string {
  const prefix = source === 'ascii-text' ? 'plain' : '界é👩‍💻'
  return `${prefix} ${y} v${revision}`
}

it.each(sources)(
  'bounds progressively frozen %s snapshots by the live grid',
  async (source) => {
    const runtime = await GhosttyRuntime.create()
    const terminal = runtime.createTerminal(grid)
    const state = runtime.createRenderState(terminal)
    let latest: RendererFrameSnapshot | RendererTextFrameSnapshot | undefined
    const receive = (frame: RendererFrameSnapshot | RendererTextFrameSnapshot) => {
      latest = frame
    }
    const observer = new FrameObserver({
      rows: grid.rows,
      onFrame: source === 'full' ? receive : undefined,
      onTextFrame: source === 'full' ? undefined : receive,
    })
    const payload = observePayload()
    try {
      for (let revision = 0; revision < grid.rows; revision += 1) {
        const changed = Array.from({ length: grid.rows - revision }, (_, delta) => revision + delta)
        terminal.write(
          '\x1b[?2027h' +
            changed.map((y) => `\x1b[${y + 1};1H\x1b[2K${rowText(source, y, revision)}`).join(''),
        )
        state.update()
        observer.emit(
          state,
          state.readCursor(),
          undefined,
          changed,
          source === 'paint-text'
            ? state.readRows({ rows: new Set(changed), packed: true })
            : undefined,
        )
        state.acknowledge()
      }
      payload.restore()
      expect(latest!.rows.map(({ y, text }) => ({ y, text: text.trimEnd() }))).toEqual(
        Array.from({ length: grid.rows }, (_, y) => ({ y, text: rowText(source, y, y) })),
      )
      const recordWords = source === 'full' || source === 'paint-text' ? 6 : 3
      const rowBytes =
        source === 'ascii-text' ? Math.ceil(grid.columns / 32) * 4 : grid.columns * recordWords * 4
      const liveBytes = grid.rows * (rowBytes + 64)
      expect(await payload.bytes()).toBeLessThanOrEqual(liveBytes)
      // Lazy arrays remain valid after collection, native scratch reuse, resize, clear and disposal.
      const expected = state
        .readTextRows()
        .map(({ cells, continuations }) => ({ cells, continuations }))
      terminal.resize({ columns: 4, rows: 2 })
      terminal.write('\x1b[2J\x1b[Hnew')
      state.update()
      state.readRows({ packed: true })
      state.readTextRows()
      observer.resize(2)
      runtime.dispose()
      expect(latest!.rows.map(({ cells, continuations }) => ({ cells, continuations }))).toEqual(
        expected,
      )
      expectFrozenRows(latest!.rows)
      latest = undefined
      expect(await payload.bytes()).toBe(0)
    } finally {
      payload.restore()
      runtime.dispose()
    }
  },
  30_000,
)

it.each(sources)(
  'a single held %s row owns only its payload',
  async (source) => {
    const runtime = await GhosttyRuntime.create()
    const terminal = runtime.createTerminal(grid)
    const state = runtime.createRenderState(terminal)
    let held: RendererTextFrameRow | undefined
    const receive = (frame: RendererFrameSnapshot | RendererTextFrameSnapshot) => {
      held = frame.rows[50]
    }
    const observer = new FrameObserver({
      rows: grid.rows,
      onFrame: source === 'full' ? receive : undefined,
      onTextFrame: source === 'full' ? undefined : receive,
    })
    const payload = observePayload()
    try {
      terminal.write(
        '\x1b[?2027h' +
          Array.from(
            { length: grid.rows },
            (_, y) => `\x1b[${y + 1};1H${rowText(source, y, 0)}`,
          ).join(''),
      )
      state.update()
      observer.emit(
        state,
        state.readCursor(),
        undefined,
        Array.from({ length: grid.rows }, (_, y) => y),
        source === 'paint-text' ? state.readRows({ packed: true }) : undefined,
      )
      payload.restore()
      observer.resize()
      terminal.write('\x1b[2J\x1b[Hcleared')
      state.update()
      state.readRows({ packed: true })
      state.readTextRows()
      runtime.dispose()
      const recordWords = source === 'full' || source === 'paint-text' ? 6 : 3
      const rowBytes =
        source === 'ascii-text' ? Math.ceil(grid.columns / 32) * 4 : grid.columns * recordWords * 4
      expect(await payload.bytes()).toBeLessThanOrEqual(rowBytes + 64)
      expect(held!.text.trimEnd()).toBe(rowText(source, 50, 0))
      expect(
        held!.cells
          .filter((_, index) => !held!.continuations[index])
          .map((cell) => cell || ' ')
          .join('')
          .trimEnd(),
      ).toBe(rowText(source, 50, 0))
      held = undefined
      expect(await payload.bytes()).toBe(0)
    } finally {
      payload.restore()
      runtime.dispose()
    }
  },
  30_000,
)

it('a held packed readRows result owns one row after native disposal', async () => {
  const runtime = await GhosttyRuntime.create()
  const terminal = runtime.createTerminal(grid)
  const state = runtime.createRenderState(terminal)
  let held: RenderRow | undefined
  const payload = observePayload()
  try {
    terminal.write(
      '\x1b[?2027h' +
        Array.from(
          { length: grid.rows },
          (_, y) => `\x1b[${y + 1};1H${rowText('full', y, 0)}`,
        ).join(''),
    )
    state.update()
    held = state.readRows({ packed: true })[50]
    payload.restore()
    runtime.dispose()
    expect(await payload.bytes()).toBeLessThanOrEqual(grid.columns * 6 * 4 + 64)
    expect(
      held!.cells
        .filter((cell) => !cell.continuation)
        .map((cell) => cell.text || ' ')
        .join('')
        .trimEnd(),
    ).toBe(rowText('full', 50, 0))
    held = undefined
    expect(await payload.bytes()).toBe(0)
  } finally {
    payload.restore()
    runtime.dispose()
  }
}, 30_000)
