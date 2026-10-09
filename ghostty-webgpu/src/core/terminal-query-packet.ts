import type { TerminalData } from './abi.js'
import { assertGhosttyResult, createGhosttyError } from './error.js'
import type { GhosttyRuntime } from './runtime.js'

type TerminalQueryData =
  | TerminalData.Columns
  | TerminalData.Rows
  | TerminalData.CursorPendingWrap
  | TerminalData.CursorVisible
  | TerminalData.CursorX
  | TerminalData.CursorY

export class TerminalQueryPacket {
  private readonly count: number
  private readonly buffer: number
  private readonly bufferSize: number
  private readonly writtenOffset: number
  private readonly outputOffset: number

  constructor(
    private readonly runtime: GhosttyRuntime,
    keys: readonly TerminalQueryData[],
  ) {
    this.count = keys.length
    this.writtenOffset = keys.length * 8
    this.outputOffset = this.writtenOffset + 4
    this.bufferSize = this.outputOffset + keys.length * 4
    this.buffer = runtime.memory.allocate(this.bufferSize)
    const view = runtime.memory.view
    for (let index = 0; index < keys.length; index += 1) {
      view.setInt32(this.buffer + index * 4, keys[index]!, true)
      view.setUint32(
        this.buffer + keys.length * 4 + index * 4,
        this.buffer + this.outputOffset + index * 4,
        true,
      )
    }
  }

  read<T>(terminal: number, read: (pointer: number) => T): T {
    this.runtime.memory.bytes.fill(
      0,
      this.buffer + this.writtenOffset,
      this.buffer + this.bufferSize,
    )
    assertGhosttyResult(
      'ghostty_terminal_get_multi',
      this.runtime.exports.ghostty_terminal_get_multi(
        terminal,
        this.count,
        this.buffer,
        this.buffer + this.count * 4,
        this.buffer + this.writtenOffset,
      ),
    )
    const written = this.runtime.memory.view.getUint32(this.buffer + this.writtenOffset, true)
    if (written !== this.count)
      throw createGhosttyError(
        'ghostty_terminal_get_multi',
        `Terminal query wrote ${written} of ${this.count} fields`,
      )
    return read(this.buffer + this.outputOffset)
  }

  dispose(): void {
    this.runtime.memory.free(this.buffer, this.bufferSize)
  }
}
