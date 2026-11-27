import path from 'node:path'
import { spawnPipePty, type PipePtyHandle, type Pty } from '@workspace/pty'
import type { TerminalPtyFactory, TerminalPtyOptions } from './service'

const encoder = new TextEncoder()
const INTERACTIVE_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ash'])

/**
 * Interactive shell fallback over stdio pipes when native PTYs are unavailable.
 * Launches bare shells with `-i`, translates CR input to LF, forwards Ctrl+C as SIGINT
 * to the child process group, and normalizes LF output to CRLF.
 */
export function pipeShellPtyFactory(): TerminalPtyFactory {
  return (options: TerminalPtyOptions): Pty => {
    let previousByte = 0
    const pty = spawnPipePty({
      command: interactiveShellCommand(options.command),
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
      onData: (bytes) => {
        const normalized = normalizeOutputLineEndings(bytes, previousByte)
        previousByte = bytes.at(-1) ?? previousByte
        options.onData(normalized)
      },
    })
    return {
      get pid() {
        return pty.pid
      },
      get exited() {
        return pty.exited
      },
      write(data: string | Uint8Array) {
        deliverInteractiveInput(pty, data)
      },
      resize(cols: number, rows: number) {
        pty.resize(cols, rows)
      },
      kill(signal?: NodeJS.Signals) {
        pty.kill(signal)
      },
      [Symbol.asyncDispose]() {
        return pty[Symbol.asyncDispose]()
      },
    }
  }
}

export function interactiveShellCommand(
  command: readonly [string, ...string[]],
): readonly [string, ...string[]] {
  if (command.length !== 1) return command
  const base = path.basename(command[0])
  if (!INTERACTIVE_SHELLS.has(base)) return command
  return [command[0], '-i']
}

function deliverInteractiveInput(pty: PipePtyHandle, data: string | Uint8Array) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  const normalized = normalizeInputLineEndings(bytes)
  let start = 0
  for (let index = 0; index < normalized.byteLength; index += 1) {
    if (normalized[index] !== 0x03) continue
    if (index > start) pty.write(normalized.subarray(start, index))
    pty.signal('SIGINT')
    start = index + 1
  }
  if (start < normalized.byteLength) pty.write(normalized.subarray(start))
}

export function normalizeInputLineEndings(data: string | Uint8Array): Uint8Array {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  const out: number[] = []
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!
    if (byte === 0x0d) {
      out.push(0x0a)
      if (bytes[index + 1] === 0x0a) index += 1
      continue
    }
    out.push(byte)
  }
  return new Uint8Array(out)
}

export function normalizeOutputLineEndings(bytes: Uint8Array, previousByte = 0): Uint8Array {
  let extra = 0
  let prev = previousByte
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!
    if (byte === 0x0a && prev !== 0x0d) extra += 1
    prev = byte
  }
  if (extra === 0) return bytes

  const out = new Uint8Array(bytes.byteLength + extra)
  let cursor = 0
  prev = previousByte
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!
    if (byte === 0x0a && prev !== 0x0d) out[cursor++] = 0x0d
    out[cursor++] = byte
    prev = byte
  }
  return out
}
