import { TerminalData } from './abi.js'
import { assertGhosttyResult, createGhosttyError } from './error.js'
import { requireLayout } from './memory.js'
import type { GhosttyRuntime } from './runtime.js'
import { decodeSafeUint64 } from './safe-uint64.js'
import type { TerminalScrollSnapshot } from './types.js'

const keys = [
  TerminalData.ScrollbackRows,
  TerminalData.Scrollbar,
  TerminalData.ViewportActive,
] as const
const valuesOffset = keys.length * 4
const writtenOffset = keys.length * 8

function alignOffset(offset: number, alignment: number): number {
  return Math.ceil(offset / alignment) * alignment
}

export class ScrollSnapshotReader {
  private readonly buffer: number
  private readonly bufferSize: number
  private readonly scrollbarLayout
  private readonly scrollbackOffset = writtenOffset + 4
  private readonly scrollbarOffset: number
  private readonly viewportOffset: number

  constructor(private readonly runtime: GhosttyRuntime) {
    this.scrollbarLayout = requireLayout(runtime.layouts, 'GhosttyTerminalScrollbar')
    this.scrollbarOffset = alignOffset(this.scrollbackOffset + 4, this.scrollbarLayout.align)
    this.viewportOffset = this.scrollbarOffset + this.scrollbarLayout.size
    this.bufferSize = this.viewportOffset + 1
    this.buffer = runtime.memory.allocate(this.bufferSize)
    const view = runtime.memory.view
    const offsets = [this.scrollbackOffset, this.scrollbarOffset, this.viewportOffset]
    for (let index = 0; index < keys.length; index += 1) {
      view.setInt32(this.buffer + index * 4, keys[index]!, true)
      view.setUint32(this.buffer + valuesOffset + index * 4, this.buffer + offsets[index]!, true)
    }
  }

  read(terminal: number): TerminalScrollSnapshot {
    this.runtime.memory.bytes.fill(0, this.buffer + writtenOffset, this.buffer + this.bufferSize)
    assertGhosttyResult(
      'ghostty_terminal_get_multi',
      this.runtime.exports.ghostty_terminal_get_multi(
        terminal,
        keys.length,
        this.buffer,
        this.buffer + valuesOffset,
        this.buffer + writtenOffset,
      ),
    )
    const view = this.runtime.memory.view
    const written = view.getUint32(this.buffer + writtenOffset, true)
    if (written !== keys.length) {
      throw createGhosttyError(
        'ghostty_terminal_get_multi',
        `Scroll query wrote ${written} of ${keys.length} fields`,
      )
    }
    const fields = this.scrollbarLayout.fields
    const scrollbar = this.buffer + this.scrollbarOffset
    return {
      scrollbackLength: view.getUint32(this.buffer + this.scrollbackOffset, true),
      scrollbar: {
        length: decodeSafeUint64(
          view,
          scrollbar + fields.len!.offset,
          'scrollbar length',
          'ghostty_terminal_get_multi(SCROLLBAR)',
        ),
        offset: decodeSafeUint64(
          view,
          scrollbar + fields.offset!.offset,
          'scrollbar offset',
          'ghostty_terminal_get_multi(SCROLLBAR)',
        ),
        total: decodeSafeUint64(
          view,
          scrollbar + fields.total!.offset,
          'scrollbar total',
          'ghostty_terminal_get_multi(SCROLLBAR)',
        ),
      },
      viewportActive: view.getUint8(this.buffer + this.viewportOffset) !== 0,
    }
  }

  dispose(): void {
    this.runtime.memory.free(this.buffer, this.bufferSize)
  }
}
