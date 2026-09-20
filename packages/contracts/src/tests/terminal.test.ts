import { describe, expect, it } from 'vitest'

import {
  parseTerminalClientMessage,
  parseTerminalServerMessage,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from '../terminal'

describe('terminal protocol', () => {
  it('preserves binary input and output including invalid UTF-8 and view boundaries', () => {
    const buffer = new Uint8Array([42, 0, 255, 192, 128, 27, 42])
    const data = buffer.subarray(1, -1)
    expect(parseTerminalClientMessage(data)).toEqual({ type: 'input', data })
    expect(parseTerminalServerMessage(data)).toEqual({ type: 'output', data })
    const binaryFrame = data.slice().buffer
    expect(parseTerminalClientMessage(binaryFrame)).toEqual({ type: 'input', data })
    expect(parseTerminalServerMessage(binaryFrame)).toEqual({ type: 'output', data })
  })

  it('does not interpret binary JSON-looking bytes as controls', () => {
    const data = new TextEncoder().encode('{"type":"dispose"}')
    expect(parseTerminalClientMessage(data)).toEqual({ type: 'input', data })
    expect(parseTerminalServerMessage(data)).toEqual({ type: 'output', data })
  })

  it('rejects text envelopes for terminal bytes', () => {
    expect(parseTerminalClientMessage({ type: 'input', data: 'pwd\r' })).toBeNull()
    expect(parseTerminalClientMessage('{"type":"input","data":"ls\\r"}')).toBeNull()
    expect(parseTerminalServerMessage({ type: 'output', data: 'ok' })).toBeNull()
    expect(parseTerminalServerMessage('{"type":"output","data":"ok"}')).toBeNull()
  })

  it('normalizes client resize dimensions to bounded integers', () => {
    expect(
      parseTerminalClientMessage({
        cols: TERMINAL_MAX_COLS + 50,
        rows: TERMINAL_MIN_ROWS + 0.8,
        type: 'resize',
      }),
    ).toEqual({
      cols: TERMINAL_MAX_COLS,
      rows: TERMINAL_MIN_ROWS,
      type: 'resize',
    })
    expect(
      parseTerminalClientMessage({
        cols: TERMINAL_MIN_COLS - 100,
        rows: TERMINAL_MAX_ROWS + 100,
        type: 'resize',
      }),
    ).toEqual({
      cols: TERMINAL_MIN_COLS,
      rows: TERMINAL_MAX_ROWS,
      type: 'resize',
    })
  })

  it('parses client dispose messages', () => {
    expect(parseTerminalClientMessage({ type: 'dispose' })).toEqual({ type: 'dispose' })
    expect(parseTerminalClientMessage('{"type":"dispose"}')).toEqual({ type: 'dispose' })
  })

  it('rejects malformed client messages', () => {
    expect(parseTerminalClientMessage('{')).toBeNull()
    expect(parseTerminalClientMessage({ type: 'input', data: 1 })).toBeNull()
    expect(parseTerminalClientMessage({ type: 'resize', cols: '80', rows: 24 })).toBeNull()
    expect(parseTerminalClientMessage({ type: 'unknown' })).toBeNull()
  })

  it('parses server messages and rejects malformed payloads', () => {
    expect(
      parseTerminalServerMessage({
        cwd: '/workspace',
        shell: '/bin/zsh',
        type: 'ready',
        restoredHistory: false,
      }),
    ).toEqual({
      cwd: '/workspace',
      shell: '/bin/zsh',
      type: 'ready',
      restoredHistory: false,
    })
    expect(parseTerminalServerMessage({ type: 'process', name: 'nvim' })).toEqual({
      name: 'nvim',
      type: 'process',
    })
    expect(parseTerminalServerMessage({ type: 'process', name: 1 })).toBeNull()
    expect(parseTerminalServerMessage({ type: 'exit', exitCode: null })).toEqual({
      exitCode: null,
      type: 'exit',
    })
    expect(parseTerminalServerMessage({ type: 'error', message: 'failed' })).toEqual({
      message: 'failed',
      type: 'error',
    })
    expect(parseTerminalServerMessage({ type: 'exit', exitCode: Number.NaN })).toBeNull()
  })
})
