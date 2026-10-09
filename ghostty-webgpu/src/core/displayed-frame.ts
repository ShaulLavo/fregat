import { assertGhosttyResult, createGhosttyError } from './error.js'
import { RowReader } from './row-reader.js'
import { TextRowReader } from './text-row-reader.js'
import type { GhosttyRuntime } from './runtime.js'
import type { ReadRowsOptions, ReadTextRowsOptions, RenderRow, RenderTextRow } from './types.js'

type DisplayedRowsOptions = Pick<ReadRowsOptions, 'rows' | 'packed'>
type DisplayedTextOptions = Pick<ReadTextRowsOptions, 'rows'>

export interface NativeDisplayedFrame {
  readonly token: number
  readRows(options?: DisplayedRowsOptions): readonly RenderRow[]
  readTextRows(options?: DisplayedTextOptions): readonly RenderTextRow[]
  readPreviousTextRows(): readonly RenderTextRow[]
}

interface NativeSlot {
  readonly handle: number
  readonly columns: number
  readonly rows: number
}

interface PackedDescriptor {
  readonly bits: Record<string, { readonly lsb: number; readonly width: number }>
}

export class DisplayedFrameStore {
  private current?: NativeSlot
  private previous?: NativeSlot
  private spare?: NativeSlot
  private disposed = false
  private token = 0
  private readonly rowReader: RowReader
  private readonly textReader: TextRowReader
  private readonly previousReader: TextRowReader

  constructor(private readonly runtime: GhosttyRuntime) {
    this.rowReader = new RowReader(runtime, (...args) => runtime.bridge.readRetainedRows(...args))
    this.textReader = new TextRowReader(runtime, (...args) =>
      runtime.bridge.readRetainedText(...args),
    )
    this.previousReader = new TextRowReader(runtime, (...args) =>
      runtime.bridge.readRetainedText(...args),
    )
  }

  capture(
    state: number,
    iterator: number,
    cells: number,
    grid: { columns: number; rows: number },
  ): NativeDisplayedFrame {
    if (this.disposed) throw createGhosttyError('retain_frame', 'Displayed-frame store is disposed')
    const descriptor = this.runtime.layouts.GhosttyCell as unknown as PackedDescriptor
    const tag = descriptor.bits.content_tag
    const style = descriptor.bits.style_id
    if (!tag || tag.width !== 2 || !style || style.width < 1 || style.width > 32)
      throw createGhosttyError('retain_frame', 'Native cell layout cannot be retained')
    let next = this.spare
    if (!next || next.columns !== grid.columns || next.rows !== grid.rows) {
      const handle = this.runtime.bridge.createRetainedFrame(grid.columns, grid.rows)
      if (!handle)
        throw createGhosttyError('retain_frame', 'Native displayed-frame allocation failed')
      next = { handle, ...grid }
    }
    try {
      assertGhosttyResult(
        'retain_frame',
        this.runtime.bridge.captureRetainedFrame(
          next.handle,
          state,
          iterator,
          cells,
          tag.lsb,
          style.lsb,
          style.width,
        ),
      )
    } catch (cause) {
      if (next !== this.spare) this.runtime.bridge.destroyRetainedFrame(next.handle)
      throw cause
    }
    if (this.spare && next !== this.spare)
      this.runtime.bridge.destroyRetainedFrame(this.spare.handle)
    this.spare = this.previous
    this.previous = this.current
    this.current = next
    const token = ++this.token
    const current = next
    const previous = this.previous
    let rows: readonly RenderTextRow[] | undefined
    let previousRows: readonly RenderTextRow[] | undefined
    const active = () => {
      if (token !== this.token || this.current !== current)
        throw createGhosttyError('read_displayed_frame', 'Displayed-frame token has retired')
    }
    return Object.freeze({
      token,
      readRows: (options: DisplayedRowsOptions = {}) => {
        active()
        return this.rowReader.read(current.handle, 0, 0, current, options)
      },
      readTextRows: (options: DisplayedTextOptions = {}) => {
        active()
        if (options.rows) return this.textReader.read(current.handle, 0, 0, current, options)
        return (rows ??= this.textReader.read(current.handle, 0, 0, current, options))
      },
      readPreviousTextRows: () => {
        active()
        if (!previous) return Object.freeze([])
        return (previousRows ??= this.previousReader.read(previous.handle, 0, 0, previous, {}))
      },
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.token += 1
    if (this.current) this.runtime.bridge.destroyRetainedFrame(this.current.handle)
    if (this.previous) this.runtime.bridge.destroyRetainedFrame(this.previous.handle)
    if (this.spare) this.runtime.bridge.destroyRetainedFrame(this.spare.handle)
    this.spare = undefined
    this.current = undefined
    this.previous = undefined
    this.rowReader.dispose()
    this.textReader.dispose()
    this.previousReader.dispose()
  }
}
