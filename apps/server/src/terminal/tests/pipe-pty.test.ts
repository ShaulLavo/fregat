import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthConfig } from '../../auth'
import { createWorkspacePaths } from '../../fs/path'
import { createOrchestrationFixture } from '../../../test/factories/orchestration'
import {
  interactiveShellCommand,
  normalizeInputLineEndings,
  normalizeOutputLineEndings,
  pipeShellPtyFactory,
} from '../pipe-pty'
import { TerminalService } from '../service'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

const fixtures: Array<Awaited<ReturnType<typeof createOrchestrationFixture>>> = []
const services: TerminalService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

describe('pipe shell PTY fallback', () => {
  it('adds -i for bare POSIX shells and preserves explicit arguments', () => {
    expect(interactiveShellCommand(['/bin/sh'])).toEqual(['/bin/sh', '-i'])
    expect(interactiveShellCommand(['bash'])).toEqual(['bash', '-i'])
    expect(interactiveShellCommand(['/bin/sh', '-c', 'true'])).toEqual(['/bin/sh', '-c', 'true'])
    expect(interactiveShellCommand(['node'])).toEqual(['node'])
  })

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

  it('runs an interactive shell with prompt, Ctrl+C interrupt, and CRLF output', async () => {
    const factory = pipeShellPtyFactory()
    const chunks: Uint8Array[] = []
    const text = () => chunks.map((chunk) => decoder.decode(chunk)).join('')
    const pty = await factory({
      key: 'test-pipe-shell',
      command: ['/bin/sh'],
      cwd: process.cwd(),
      env: { ...process.env, PS1: 'PIPE> ' },
      cols: 80,
      rows: 24,
      onData: (bytes) => chunks.push(bytes.slice()),
    })

    try {
      pty.write('printf "flags=%s\\n" "$-"\r')
      await expect.poll(text).toContain('PIPE>')
      await expect.poll(text).toMatch(/flags=[^\r\n]*i/)

      pty.write('printf "JOB-STARTED\\n"; sleep 30\r')
      await expect.poll(text).toContain('JOB-STARTED\r\n')
      pty.write('\x03')
      await Bun.sleep(100)
      pty.write('printf "AFTER-CTRL-C\\n"\r')
      await expect.poll(text).toContain('AFTER-CTRL-C\r\n')

      pty.write('exit 0\r')
      expect(await pty.exited).toEqual({ exitCode: 0, signal: null })
    } finally {
      await pty[Symbol.asyncDispose]()
    }
  })

  it('delivers Ctrl+C via child.kill when process.kill is unavailable (ENOSYS)', async () => {
    const factory = pipeShellPtyFactory()
    const chunks: Uint8Array[] = []
    const text = () => chunks.map((chunk) => decoder.decode(chunk)).join('')
    const pty = await factory({
      key: 'test-pipe-sigint-enosys',
      command: [
        process.execPath,
        '-e',
        'process.on("SIGINT", () => console.log("CAUGHT-SIGINT")); console.log("READY"); setInterval(() => {}, 1000)',
      ],
      cwd: process.cwd(),
      env: process.env,
      cols: 80,
      rows: 24,
      onData: (bytes) => chunks.push(bytes.slice()),
    })

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('ENOSYS: function not implemented, kill'), { code: 'ENOSYS' })
    })
    try {
      await expect.poll(text).toContain('READY\r\n')
      pty.write('\x03')
      await expect.poll(text).toContain('CAUGHT-SIGINT\r\n')
    } finally {
      killSpy.mockRestore()
      await pty[Symbol.asyncDispose]()
    }
  })

  it('terminates directly owned local pipe shells when TerminalService disposes', async () => {
    const fixture = await createOrchestrationFixture()
    fixtures.push(fixture)
    const { result } = await fixture.register(fixture.checkout)
    if (!result) throw new TypeError('Missing worktree registration')
    const service = new TerminalService({
      database: fixture.database,
      env: { ...process.env, SHELL: '/bin/sh', PS1: 'PIPE> ' },
      paths: createWorkspacePaths(fixture.checkout),
      resolveWorktree: async () => fixture.checkout,
      lifecycle: { begin: (id, key) => fixture.engine.beginTerminalLease(id, key) },
      nativePty: false,
    })
    services.push(service)

    const output: string[] = []
    const socket = {
      raw: {},
      data: {
        headers: { origin: 'http://localhost:5173' },
        query: { worktreeId: result.worktreeId, terminalId: 'pipe-dispose-test' },
      },
      send(frame: unknown) {
        if (frame instanceof Uint8Array) output.push(decoder.decode(frame))
      },
      close() {},
    }
    const routes = service.routes(createAuthConfig({ allowedOrigins: ['http://localhost:5173'] }))
    await routes.open(socket)
    routes.message(socket, encoder.encode('echo "PID=$$"\r'))
    await expect.poll(() => output.join('')).toMatch(/PID=\d+/)

    const match = /PID=(\d+)/.exec(output.join(''))
    const pid = Number(match?.[1])
    expect(pid).toBeGreaterThan(0)

    await service.dispose()
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      })
      .toBe(false)
  })
})
