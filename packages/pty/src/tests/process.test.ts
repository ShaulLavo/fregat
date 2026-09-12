import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { spawnPty } from '../index'
import { childCommand, expect, processExists, terminalDescriptors, test } from '../../test/fixtures'

test('passes arguments, cwd, environment and initial size to a direct child with three TTYs', async ({
  launch,
  root,
}) => {
  const captured = launch({
    command: childCommand('metadata', 'two words', 'quotes"and\'symbols'),
    cwd: root,
    env: { PATH: process.env.PATH, PTY_TEST_VALUE: 'inherited explicitly' },
    cols: 101,
    rows: 37,
  })

  expect(await captured.pty.exited).toEqual({ exitCode: 7, signal: null })
  expect(JSON.parse(captured.text.trim())).toEqual({
    args: ['two words', 'quotes"and\'symbols'],
    cwd: await realpath(root),
    env: 'inherited explicitly',
    pid: captured.pty.pid,
    ppid: process.pid,
    tty: [true, true, true],
    size: [101, 37],
  })
  expect(processExists(captured.pty.pid)).toBe(false)
})

test('propagates resize through the real terminal and SIGWINCH', async ({ launch }) => {
  const captured = launch({ command: childCommand('resize'), cols: 80, rows: 24 })
  await captured.waitFor('SIZE:80x24')
  captured.pty.resize(123, 41)
  await captured.waitFor('SIZE:123x41')
  captured.pty.write('q')
  expect(await captured.pty.exited).toEqual({ exitCode: 0, signal: null })
})

test('runs an alternate-screen TUI with raw arrow input and resize', async ({ launch }) => {
  const captured = launch({ command: childCommand('tui'), cols: 80, rows: 24 })
  await captured.waitFor('SIZE:80x24')
  expect(captured.text).toContain('\x1b[?1049h\x1b[2J\x1b[H')
  captured.pty.write('\x1b[A')
  await captured.waitFor('KEY:1b5b41')
  captured.pty.resize(111, 35)
  await captured.waitFor('SIZE:111x35')
  captured.pty.write('q')
  await captured.pty.exited
  expect(captured.text).toContain('\x1b[?1049l')
})

test('delivers Ctrl-C to a foreground job and leaves the interactive shell usable', async ({
  launch,
}) => {
  const captured = launch({
    command: ['/bin/sh', '-i'],
    env: { PATH: process.env.PATH, PS1: 'PROMPT>' },
  })
  await captured.waitFor('PROMPT>')
  captured.pty.write("stty -echo; printf 'JOB''-READY\\n'; sleep 30\n")
  await captured.waitFor('JOB-READY')
  captured.pty.write('\x03')
  captured.pty.write("printf 'SHELL-ALIVE\\n'\n")
  await captured.waitFor('SHELL-ALIVE')
  captured.pty.write('exit\n')
  expect(await captured.pty.exited).toEqual({ exitCode: 0, signal: null })
})

test('delivers Ctrl-D as EOF to an interactive shell', async ({ launch }) => {
  const captured = launch({
    command: ['/bin/sh', '-i'],
    env: { PATH: process.env.PATH, PS1: 'PROMPT>' },
  })
  await captured.waitFor('PROMPT>')
  captured.pty.write('\x04')
  expect(await captured.pty.exited).toEqual({ exitCode: 0, signal: null })
})

test('preserves every retained output byte before resolving exit for a large binary burst', async ({
  launch,
}) => {
  const length = 2 * 1024 * 1024
  const expected = Buffer.alloc(length)
  for (let index = 0; index < length; index++) expected[index] = index % 256
  const captured = launch({ command: childCommand('output', String(length)) })

  expect(await captured.pty.exited).toEqual({ exitCode: 23, signal: null })
  expect(captured.chunks.length).toBeGreaterThan(1)
  expect(captured.bytes.equals(expected)).toBe(true)
  await Bun.sleep(10)
  expect(captured.bytes.equals(expected)).toBe(true)
})

test('queues large binary input until a delayed reader consumes it, keeping later writes ordered', async ({
  launch,
}) => {
  const bytes = Buffer.alloc(2 * 1024 * 1024)
  for (let index = 0; index < bytes.byteLength; index++) bytes[index] = index % 256
  const tail = 'tail after binary'
  const expected = createHash('sha256').update(bytes).update(tail).digest('hex')
  const length = bytes.byteLength + Buffer.byteLength(tail)
  const captured = launch({ command: childCommand('input', String(length)) })
  await captured.waitFor('READY')
  captured.pty.write(bytes)
  bytes.fill(42)
  captured.pty.write(tail)

  expect(await captured.pty.exited).toEqual({ exitCode: 0, signal: null })
  expect(captured.text).toContain(`RECEIVED:${length}:${expected}`)
})

test('honors the operating system terminal lifetime after the session leader exits', async ({
  launch,
  root,
}) => {
  const reportFile = `${root}/tail-write-result`
  // Darwin revokes the slave at session-leader exit; Linux permits the later write.
  const expected =
    process.platform === 'darwin'
      ? { output: 'HEAD', write: 'EIO' }
      : { output: 'HEADTAIL', write: 'written' }
  const captured = launch({ command: childCommand('delayed-tail', '150', reportFile) })
  expect(await captured.pty.exited).toEqual({ exitCode: 7, signal: null })
  expect(captured.text).toBe(expected.output)
  await expect
    .poll(async () => (await Bun.file(reportFile).exists()) && Bun.file(reportFile).text())
    .toBe(expected.write)
})

test('reports a requested terminating signal and reaps the child', async ({ launch }) => {
  const before = terminalDescriptors()
  const captured = launch({ command: childCommand('resize') })
  await captured.waitFor('SIZE:')
  expect(terminalDescriptors()).not.toEqual(before)
  captured.pty.kill('SIGTERM')
  const exit = await captured.pty.exited
  expect(exit.signal).toBe('SIGTERM')
  expect(processExists(captured.pty.pid)).toBe(false)
  await expect.poll(terminalDescriptors).toEqual(before)
})

test('escalates an ignored signal to SIGKILL after the grace period', async ({ launch }) => {
  const captured = launch({ command: childCommand('stubborn') })
  await captured.waitFor('READY')
  const start = performance.now()
  captured.pty.kill('SIGTERM')
  const exit = await captured.pty.exited

  expect(exit.signal).toBe('SIGKILL')
  expect(performance.now() - start).toBeGreaterThanOrEqual(200)
  expect(performance.now() - start).toBeLessThan(3000)
  expect(processExists(captured.pty.pid)).toBe(false)
})

test('supports repeated termination and disposal without leaving live children', async ({
  launch,
}) => {
  const captured = launch({ command: childCommand('stubborn') })
  await captured.waitFor('READY')
  await Promise.all([captured.pty[Symbol.asyncDispose](), captured.pty[Symbol.asyncDispose]()])
  captured.pty.kill()
  await captured.pty[Symbol.asyncDispose]()
  expect(processExists(captured.pty.pid)).toBe(false)
})

test('closes PTY descriptors after natural exit and explicit disposal', async ({ launch }) => {
  const before = terminalDescriptors()
  for (let index = 0; index < 8; index++) {
    const captured = launch({ command: ['/bin/sh', '-c', 'printf done'] })
    await captured.pty.exited
    await captured.pty[Symbol.asyncDispose]()
    expect(captured.text).toBe('done')
  }
  // Bun closes the PTY reader/writer descriptors on its native worker pool.
  await expect.poll(terminalDescriptors).toEqual(before)
})

test('fails invalid spawns without leaking PTY descriptors', async () => {
  const before = terminalDescriptors()
  for (let index = 0; index < 8; index++) {
    expect(() =>
      spawnPty({ command: ['/definitely/missing/pty-test-command'], onData() {} }),
    ).toThrow()
  }
  await expect.poll(terminalDescriptors).toEqual(before)
})

test('rejects completion and releases the child and terminal when output delivery throws', async () => {
  const before = terminalDescriptors()
  const failure = new TypeError('Output consumer failed')
  const pty = spawnPty({
    command: childCommand('stubborn'),
    onData() {
      throw failure
    },
  })

  try {
    await expect(pty.exited).rejects.toMatchObject({ cause: failure })
    expect(processExists(pty.pid)).toBe(false)
    await expect.poll(terminalDescriptors).toEqual(before)
  } finally {
    await Promise.resolve(pty[Symbol.asyncDispose]()).catch(() => {})
  }
})

test('cleans up after the session leader exits with a live descendant', async ({ launch }) => {
  const before = terminalDescriptors()
  const captured = launch({ command: childCommand('held-tail', '5000') })
  await captured.waitFor('HEAD:')
  const descendantPid = Number(captured.text.match(/HEAD:(\d+)/)?.[1])
  expect(Number.isSafeInteger(descendantPid)).toBe(true)

  try {
    await expect.poll(() => processExists(captured.pty.pid)).toBe(false)
    const started = performance.now()
    await captured.pty[Symbol.asyncDispose]()
    if (process.platform === 'linux') {
      expect(performance.now() - started).toBeGreaterThanOrEqual(200)
    }
    expect(performance.now() - started).toBeLessThan(3000)
    expect(await captured.pty.exited).toEqual({ exitCode: 7, signal: null })
    await expect.poll(terminalDescriptors).toEqual(before)
  } finally {
    if (descendantPid > 0 && processExists(descendantPid)) process.kill(descendantPid, 'SIGKILL')
  }
})
