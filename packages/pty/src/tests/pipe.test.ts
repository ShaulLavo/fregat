import { expect, test } from 'vitest'
import { hasNativePty, spawnPipePty } from '../index'

const decoder = new TextDecoder()

test('hasNativePty reports true on supported native Bun runtimes', () => {
  const arch: string = process.arch
  expect(hasNativePty()).toBe(
    (process.platform === 'linux' || process.platform === 'darwin') && arch !== 'wasm32',
  )
})

test('runs a command over pipes, streaming stdout and stderr and delivering stdin', async () => {
  const chunks: Uint8Array[] = []
  const pty = spawnPipePty({
    command: ['/bin/sh'],
    onData: (bytes) => chunks.push(bytes.slice()),
  })

  try {
    pty.resize(100, 40)
    pty.write('echo out-line\n')
    pty.write('echo err-line >&2\n')
    pty.write('exit 7\n')
    const exit = await pty.exited
    expect(exit).toEqual({ exitCode: 7, signal: null })
    const output = chunks.map((chunk) => decoder.decode(chunk)).join('')
    expect(output).toContain('out-line')
    expect(output).toContain('err-line')
  } finally {
    await pty[Symbol.asyncDispose]()
  }
})

test('terminates a running piped child cleanly on dispose', async () => {
  const pty = spawnPipePty({
    command: ['/bin/sh', '-c', 'echo ready; sleep 30'],
    onData: () => {},
  })
  await pty[Symbol.asyncDispose]()
  const exit = await pty.exited
  expect(exit.signal !== null || exit.exitCode !== 0).toBe(true)
})

test('validates dimensions and rejects missing executables cleanly', () => {
  expect(() =>
    spawnPipePty({ command: ['/definitely/missing/pipe-pty-binary'], onData: () => {} }),
  ).toThrow()
  const pty = spawnPipePty({ command: ['/bin/sh', '-c', 'true'], onData: () => {} })
  expect(() => pty.resize(0, 24)).toThrow()
  return pty.exited
})
