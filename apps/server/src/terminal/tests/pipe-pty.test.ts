import { describe, expect, it } from 'vitest'
import {
  normalizeInputLineEndings,
  normalizeOutputLineEndings,
  pipeShellPtyFactory,
} from '../pipe-pty'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

describe('pipe shell PTY fallback', () => {
  it('normalizes CR and CRLF terminal input to LF for line-oriented shells', () => {
    expect(decoder.decode(normalizeInputLineEndings('echo hi\r'))).toBe('echo hi\n')
    expect(decoder.decode(normalizeInputLineEndings('a\r\nb\rc\n'))).toBe('a\nb\nc\n')
  })

  it('normalizes bare LF output to CRLF across chunk boundaries', () => {
    expect(decoder.decode(normalizeOutputLineEndings(encoder.encode('a\nb\r\nc\n')))).toBe(
      'a\r\nb\r\nc\r\n',
    )
    // A chunk starting with LF right after a trailing CR in the previous chunk stays CRLF.
    expect(decoder.decode(normalizeOutputLineEndings(encoder.encode('\nnext\n'), 0x0d))).toBe(
      '\nnext\r\n',
    )
  })

  it('runs a real shell session via the factory with CR input and CRLF output', async () => {
    const factory = pipeShellPtyFactory()
    const chunks: Uint8Array[] = []
    const pty = await factory({
      key: 'test-pipe-shell',
      command: ['/bin/sh'],
      cwd: process.cwd(),
      env: process.env,
      cols: 80,
      rows: 24,
      onData: (bytes) => chunks.push(bytes.slice()),
    })

    try {
      pty.write('printf "hello-wasi\\n"\r')
      pty.write('exit 0\r')
      expect(await pty.exited).toEqual({ exitCode: 0, signal: null })
      const text = chunks.map((chunk) => decoder.decode(chunk)).join('')
      expect(text).toContain('hello-wasi\r\n')
    } finally {
      await pty[Symbol.asyncDispose]()
    }
  })
})
