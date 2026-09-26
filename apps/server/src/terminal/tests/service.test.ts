import * as v from 'valibot'
import { terminalHistoryChunks, terminalSessionOffsets } from '../../db/schema'
import { mkdir, realpath, rm, symlink, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElysiaWS } from 'elysia/ws'
import type { WideEvent } from 'evlog'
import { readFsLogs } from 'evlog/fs'
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MIN_ROWS,
  terminalLeaseIdSchema,
  parseTerminalServerMessage,
  type TerminalServerMessage,
  worktreeIdSchema,
  sessionIdSchema,
} from '@workspace/contracts'

import { createOrchestrationFixture } from '../../../test/factories/orchestration'
import { createTestTerminalHost } from '../../../test/factories/terminal-host'
import { createFakeTerminalHost } from '../../../test/factories/fake-terminal-host'
import {
  createFakePtyFactory,
  terminalOutputBytes,
  terminalOutputText,
} from '../../../test/factories/terminal'
import { requireWorktree } from '../../orchestration/read-model'
import { terminalHostErrors } from '../../terminal-host/protocol'
import { TerminalHistory } from '../history'
import { projectionTerminalLeases } from '../../db/schema'
import { createAuthConfig } from '../../auth'
import { createWorkspacePaths, type WorkspacePaths } from '../../fs/path'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import {
  TerminalService,
  terminalSessionKey,
  type TerminalPtyFactory,
  type TerminalServiceOptions,
} from '../service'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const fixtures = new Map<string, Awaited<ReturnType<typeof createOrchestrationFixture>>>()
const registrations = new Map<string, string>()
const services: TerminalService[] = []

const hosts: Awaited<ReturnType<typeof createTestTerminalHost>>[] = []
const fakeHosts: Awaited<ReturnType<typeof createFakeTerminalHost>>[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(hosts.splice(0).map((host) => host.close()))
  await Promise.all(fakeHosts.splice(0).map((host) => host.close()))
  await Promise.all([...fixtures.values()].map((fixture) => fixture.close()))
  fixtures.clear()
  registrations.clear()
})

describe('terminal service', () => {
  // The WS transport shares the origin predicate with HTTP, so it has to reject
  // an off-allowlist loopback origin too - and reject it before spawning a PTY.
  it('closes a websocket opened from an untrusted loopback origin', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { env: {}, ptyFactory: pty.factory })
    const ws = fakeSocket(root, '', undefined, 'http://localhost:9999')

    await service.routes(auth()).open(ws)

    expect(ws.closed).toBe(true)
    expect(ws.closeDetails).toEqual({ code: 1008, reason: 'unauthorized' })
    expect(pty.spawns).toEqual([])
  })

  it('spawns the user shell in the resolved workspace cwd', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, {
      env: { SHELL: '/bin/zsh' },
      ptyFactory: pty.factory,
    })
    const ws = fakeSocket(root, 'project')

    await service.routes(auth()).open(ws)

    expect(pty.spawns).toEqual([
      expect.objectContaining({
        cwd: path.join(root, 'project'),
        command: ['/bin/zsh'],
      }),
    ])
    expect(ws.messages[0]).toEqual({
      cwd: path.join(root, 'project'),
      shell: '/bin/zsh',
      type: 'ready',
      restoredHistory: false,
    })
  })

  it('opens a registered canonical checkout beneath a symlinked workspace root', async () => {
    const root = await fixtureRoot()
    const alias = path.join(path.dirname(root), 'workspace-alias')
    await symlink(root, alias, 'dir')
    const pty = createFakePtyFactory()
    const service = testService(root, {
      env: { SHELL: '/bin/sh' },
      paths: createWorkspacePaths(alias),
      ptyFactory: pty.factory,
    })
    const ws = fakeSocket(root, 'project')

    await service.routes(auth()).open(ws)

    const canonicalPath = await realpath(path.join(root, 'project'))
    expect(ws.closed).toBe(false)
    expect(pty.spawns).toEqual([expect.objectContaining({ cwd: canonicalPath })])
    expect(ws.messages[0]).toMatchObject({ type: 'ready', cwd: canonicalPath })
  })

  it('refuses a registered checkout replaced by a symlink outside the real workspace root', async () => {
    const root = await fixtureRoot()
    const outside = await fixtureRoot()
    await rm(path.join(root, 'project'), { recursive: true })
    await symlink(outside, path.join(root, 'project'), 'dir')
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const ws = fakeSocket(root, 'project')

    await service.routes(auth()).open(ws)

    expect(ws.closed).toBe(true)
    expect(ws.closeDetails).toEqual({ code: 1008, reason: 'invalid-root' })
    expect(pty.spawns).toEqual([])
  })

  it('falls back from bash to sh when no user shell is available', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory({
      failShells: new Set(['bash']),
    })
    const service = testService(root, {
      env: {},
      ptyFactory: pty.factory,
    })
    const ws = fakeSocket(root, '')

    await service.routes(auth()).open(ws)

    expect(pty.spawns.map((spawn) => spawn.command[0])).toEqual(['bash', 'sh'])
    expect(ws.messages[0]).toMatchObject({ shell: 'sh', type: 'ready' })
  })

  it('ignores malformed messages and normalizes resize bounds', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '')

    await routes.open(ws)
    const input = new Uint8Array([0x70, 0x77, 0x64, 0x0d, 0xff, 0x80, 0x00])
    routes.message(ws, input.buffer)
    routes.message(ws, { type: 'input', data: 'legacy input' })
    routes.message(ws, { type: 'input', data: 1 })
    routes.message(ws, '{')
    routes.message(ws, {
      cols: TERMINAL_MAX_COLS + 100,
      rows: TERMINAL_MIN_ROWS - 100,
      type: 'resize',
    })

    expect(pty.ptys[0]?.writes).toEqual([input])
    expect(pty.ptys[0]?.resizes).toEqual([[TERMINAL_MAX_COLS, TERMINAL_MIN_ROWS]])
  })

  it('keeps the PTY alive on socket close and on service disposal', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '')

    await routes.open(ws)
    routes.close(ws)

    expect(pty.ptys).toHaveLength(1)
    expect(pty.ptys[0]?.killed).toBe(false)

    // Service dispose detaches (Plan 149 D7); only a user kill/restart ends the shell.
    await service.dispose()

    expect(pty.ptys[0]?.killed).toBe(false)
  })

  it('does not spawn a PTY when disposed during worktree resolution', async () => {
    const root = await fixtureRoot()
    const resolution = Promise.withResolvers<void>()
    const pty = createFakePtyFactory()
    const service = testService(root, {
      beforeWorktreeResolution: resolution.promise,
      env: {},
      ptyFactory: pty.factory,
    })
    const ws = fakeSocket(root, '')
    const opening = service.routes(auth()).open(ws)

    await service.dispose()
    resolution.resolve()
    await opening

    expect(pty.spawns).toEqual([])
    expect(ws.closed).toBe(true)
  })

  it('reuses the PTY and replays buffered output on reconnect', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, 'project')

    await routes.open(first)
    pty.ptys[0]?.emit(new TextEncoder().encode('streamed-output\r\n'))
    routes.close(first)

    const second = fakeSocket(root, 'project')
    await routes.open(second)

    expect(pty.ptys).toHaveLength(1)
    expect(pty.ptys[0]?.killed).toBe(false)
    expect(second.messages[0]).toMatchObject({ type: 'ready' })
    expect(terminalOutputText(second.messages)).toContain('streamed-output')
    const marker = second.messages.findIndex((message) => message.type === 'replay-complete')
    const output = second.messages.findIndex((message) => message.type === 'output')
    expect(marker).toBeGreaterThan(output)
    expect(output).toBeGreaterThan(0)

    await service.dispose()
  })

  it('preserves invalid UTF-8 and split characters through live output and replay', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '')
    await routes.open(first)
    const chunks = [new Uint8Array([0xff, 0x00, 0xf0, 0x9f]), new Uint8Array([0x98, 0x80, 0x80])]

    for (const chunk of chunks) pty.ptys[0]?.emit(chunk)
    routes.close(first)
    const second = fakeSocket(root, '')
    await routes.open(second)

    const expected = new Uint8Array([0xff, 0x00, 0xf0, 0x9f, 0x98, 0x80, 0x80])
    expect(terminalOutputBytes(first.messages)).toEqual(expected)
    expect(terminalOutputBytes(second.messages)).toEqual(expected)
  })

  it('sends byte views as binary and control messages as text through Elysia', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const socket = fakeSocket(root, '')
    const frames: unknown[] = []
    const raw = { send: (frame: unknown) => frames.push(frame) }
    socket.send = (frame) => {
      ElysiaWS.prototype.send.call({ raw }, frame)
    }

    await service.routes(auth()).open(socket)
    const bytes = new Uint8Array([0x11, 0xff, 0x00, 0x80, 0x22]).subarray(1, 4)
    pty.ptys[0]?.emit(bytes)

    expect(typeof frames[0]).toBe('string')
    expect(parseTerminalServerMessage(frames[0])).toMatchObject({ type: 'ready' })
    expect(parseTerminalServerMessage(frames[1])).toEqual({ type: 'replay-complete' })
    expect(Buffer.isBuffer(frames[2])).toBe(true)
    expect(frames[2]).toEqual(Buffer.from([0xff, 0x00, 0x80]))
  })

  it('keeps exactly the latest 8 MiB for replay even after one oversized chunk', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '')
    await routes.open(first)
    const oversized = Uint8Array.from({ length: 8 * 1024 * 1024 + 31 }, () => 97)
    const tail = new Uint8Array([0xff, 0x80, 0x00])

    pty.ptys[0]?.emit(oversized)
    pty.ptys[0]?.emit(tail)
    routes.close(first)
    const second = fakeSocket(root, '')
    await routes.open(second)

    expect(terminalOutputBytes(first.messages).length).toBe(oversized.length + tail.length)
    const replay = terminalOutputBytes(second.messages)
    expect(replay.length).toBe(8 * 1024 * 1024)
    expect(
      Buffer.compare(replay.subarray(0, -tail.length), oversized.subarray(31 + tail.length)),
    ).toBe(0)
    expect(replay.subarray(-tail.length)).toEqual(tail)
  })

  it('keeps the PTY and its replay when a disconnected socket throws while sending output', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '')
    await routes.open(first)
    first.send = () => {
      throw new TypeError('Socket disconnected')
    }
    const output = new Uint8Array([0xff, 0x00, 0x80])

    expect(() => pty.ptys[0]?.emit(output)).not.toThrow()
    expect(pty.ptys[0]?.killed).toBe(false)
    const second = fakeSocket(root, '')
    await routes.open(second)

    expect(pty.ptys).toHaveLength(1)
    expect(terminalOutputBytes(second.messages)).toEqual(output)
  })

  it('fans out live output without replaying history to existing viewers', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '')
    await routes.open(first)
    pty.ptys[0]?.emit(new TextEncoder().encode('history'))
    const second = fakeSocket(root, '')
    await routes.open(second)

    expect(first.closed).toBe(false)
    expect(terminalOutputText(first.messages)).toBe('history')
    expect(terminalOutputText(second.messages)).toBe('history')
    await expect
      .poll(() => pty.ptys[0]?.resizes)
      .toEqual([
        [81, 24],
        [80, 24],
      ])
    pty.ptys[0]?.emit(new TextEncoder().encode(' live'))
    expect(terminalOutputText(first.messages)).toBe('history live')
    expect(terminalOutputText(second.messages)).toBe('history live')
    routes.close(first)
    await Bun.sleep(10)
    expect(pty.ptys[0]?.killed).toBe(false)
    routes.message(second, new TextEncoder().encode('input'))
    expect(pty.ptys[0]?.writes).toEqual([new TextEncoder().encode('input')])
    routes.close(second)
    expect(pty.ptys[0]?.killed).toBe(false)
    await service.dispose()
    expect(pty.ptys[0]?.killed).toBe(false)
  })

  it('reports shared dimensions in band only while mode 2048 is enabled', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const socket = fakeSocket(root, '')
    await routes.open(socket)
    pty.ptys[0]?.emit(new TextEncoder().encode('\x1b]0;title \x1b[?2048h\x07'))
    routes.message(socket, { type: 'resize', cols: 90, rows: 30 })
    expect(pty.ptys[0]?.writes).toEqual([])
    pty.ptys[0]?.emit(new TextEncoder().encode('\x1b[?1004;20'))
    pty.ptys[0]?.emit(new TextEncoder().encode('48h'))
    routes.message(socket, { type: 'resize', cols: 100, rows: 35 })
    expect(pty.ptys[0]?.writes).toEqual(['\x1b[48;35;100;0;0t'])
    pty.ptys[0]?.emit(new TextEncoder().encode('\x1b[?2048l'))
    routes.message(socket, { type: 'resize', cols: 110, rows: 40 })
    expect(pty.ptys[0]?.writes).toHaveLength(1)
  })

  it('starts truncated UTF-8 replay at a complete character boundary', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '')
    await routes.open(first)
    const bytes = new TextEncoder().encode('😀' + 'x'.repeat(8 * 1024 * 1024 - 2))
    pty.ptys[0]?.emit(bytes.subarray(0, 3))
    pty.ptys[0]?.emit(bytes.subarray(3))
    const second = fakeSocket(root, '')
    await routes.open(second)

    expect(terminalOutputText(first.messages)).toBe('😀' + 'x'.repeat(8 * 1024 * 1024 - 2))
    expect(terminalOutputText(second.messages)).toBe('x'.repeat(8 * 1024 * 1024 - 2))
  })

  it('keeps terminal tab sessions isolated within the same workspace', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, 'project', 'terminal-1')
    const second = fakeSocket(root, 'project', 'terminal-2')

    await routes.open(first)
    await routes.open(second)
    routes.message(first, new TextEncoder().encode('echo first\r'))
    routes.message(second, new TextEncoder().encode('echo second\r'))

    expect(pty.ptys).toHaveLength(2)
    expect(pty.ptys[0]?.writes).toEqual([new TextEncoder().encode('echo first\r')])
    expect(pty.ptys[1]?.writes).toEqual([new TextEncoder().encode('echo second\r')])

    await service.dispose()
  })

  it('kills only the disposed terminal tab session', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '', 'terminal-1')
    const second = fakeSocket(root, '', 'terminal-2')

    await routes.open(first)
    await routes.open(second)
    routes.message(first, { type: 'dispose' })

    await expect.poll(() => pty.ptys[0]?.killed).toBe(true)
    expect(pty.ptys[1]?.killed).toBe(false)

    await service.dispose()
  })

  it('keeps detached jobs past the former timeout and replays output on reconnect', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '', 'retained-job')
    await routes.open(first)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      routes.close(first)
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
      expect(pty.ptys[0]?.killed).toBe(false)
    } finally {
      vi.useRealTimers()
    }
    pty.ptys[0]?.emit(new TextEncoder().encode('output while detached'))
    const second = fakeSocket(root, '', 'retained-job')
    await routes.open(second)
    expect(pty.ptys).toHaveLength(1)
    expect(terminalOutputText(second.messages)).toBe('output while detached')
    await service.dispose()
    expect(pty.ptys[0]?.killed).toBe(false)
  })

  it('reports the foreground process name while a viewer is attached', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const names = ['bash', 'bash', 'nvim', 'nvim']
    let reads = 0
    const service = testService(root, {
      foregroundProcess: async () => names[Math.min(reads++, names.length - 1)] ?? null,
      processPollMs: 1,
      ptyFactory: pty.factory,
    })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '', 'terminal-1')

    await routes.open(first)
    await expect.poll(() => processNames(first.messages)).toEqual(['bash', 'nvim'])

    const second = fakeSocket(root, '', 'terminal-1')
    await routes.open(second)
    expect(processNames(second.messages)).toEqual(['nvim'])

    routes.close(first)
    routes.close(second)
    const readsAfterDetach = reads
    await Bun.sleep(10)
    expect(reads).toBe(readsAfterDetach)

    await service.dispose()
  })

  it('kills a session by id without a socket', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '', 'terminal-1')

    await routes.open(ws)
    routes.close(ws)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))

    expect(await service.kill({ terminalId: 'missing', worktreeId })).toEqual({ killed: false })
    expect(await service.kill({ terminalId: 'terminal-1', worktreeId })).toEqual({ killed: true })
    expect(pty.ptys[0]?.killed).toBe(true)

    await service.dispose()
  })

  it('logs the signal exit of a shell it killed as closed at info', async () => {
    const root = await fixtureRoot()
    const logDir = observedLogDir(root)
    const pty = createFakePtyFactory({ holdUntilExit: true })
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '', 'terminal-1')
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))

    try {
      await routes.open(ws)
      const killing = service.kill({ terminalId: 'terminal-1', worktreeId })
      await vi.waitFor(() => expect(pty.ptys[0]?.killed).toBe(true))
      pty.ptys[0]?.exit(129, 'SIGHUP')

      expect(await killing).toEqual({ killed: true })
      expect(await terminalSessionEvents(logDir)).toEqual([
        expect.objectContaining({ exitCode: 129, level: 'info', outcome: 'closed' }),
      ])
    } finally {
      await resetObservabilityForTests()
    }
  })

  it('warns when a shell exits non-zero without being asked to', async () => {
    const root = await fixtureRoot()
    const logDir = observedLogDir(root)
    const pty = createFakePtyFactory({ holdUntilExit: true })
    const service = testService(root, { ptyFactory: pty.factory })
    const ws = fakeSocket(root, '', 'terminal-1')

    try {
      await service.routes(auth()).open(ws)
      pty.ptys[0]?.exit(137, 'SIGKILL')
      await vi.waitFor(() => expect(ws.closed).toBe(true))

      expect(pty.ptys[0]?.killed).toBe(false)
      expect(await terminalSessionEvents(logDir)).toEqual([
        expect.objectContaining({ exitCode: 137, level: 'warn', outcome: 'failed' }),
      ])
    } finally {
      await resetObservabilityForTests()
    }
  })

  it('persists request and claim before the PTY factory can spawn', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const observations: string[] = []
    const pty = createFakePtyFactory({
      onSpawn: () => {
        observations.push(
          ...fixture.database
            .select()
            .from(projectionTerminalLeases)
            .all()
            .map((lease) => lease.state),
        )
      },
    })
    const service = testService(root, { ptyFactory: pty.factory })
    await service.routes(auth()).open(fakeSocket(root, ''))
    expect(observations).toEqual(['claimed'])
  })

  it('holds process ownership after exit until a failed end transaction is retried successfully', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    await service.routes(auth()).open(fakeSocket(root, ''))
    fixture.sqlite
      .exec(`CREATE TEMP TRIGGER terminal_end_failure BEFORE UPDATE ON projection_terminal_leases
      WHEN NEW.state = 'ended' BEGIN SELECT RAISE(FAIL, 'storage failure'); END`)
    pty.ptys[0]?.exit(0)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(true)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(1)
    expect(fixture.engine.worktreeExecutionGate.tryAcquireExclusive(worktreeId)).toEqual({
      acquired: false,
      reason: 'active-terminal',
    })
    fixture.sqlite.exec('DROP TRIGGER terminal_end_failure')
    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(0)
  })

  it('keeps its durable lease and gate through service dispose, detached not killed', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const pty = createFakePtyFactory({ holdUntilExit: true })
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const socket = fakeSocket(root, '')
    await routes.open(socket)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(1)
    expect(fixture.engine.worktreeExecutionGate.tryAcquireExclusive(worktreeId)).toEqual({
      acquired: false,
      reason: 'active-terminal',
    })
    routes.close(socket)

    // A shutdown detaches (Plan 149 D7): the shell, its lease and the gate all survive.
    await service.dispose()

    expect(pty.ptys[0]?.killed).toBe(false)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(false)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(1)
    expect([...(await fixture.engine.readModelSnapshot()).terminalLeases.values()][0]?.state).toBe(
      'active',
    )
    expect(fixture.engine.worktreeExecutionGate.tryAcquireExclusive(worktreeId)).toEqual({
      acquired: false,
      reason: 'active-terminal',
    })
  })

  it('retains ownership and reports a rejected native exit promise', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const pty = createFakePtyFactory({ holdUntilExit: true })
    const service = testService(root, { ptyFactory: pty.factory })
    const socket = fakeSocket(root, '')
    await service.routes(auth()).open(socket)

    pty.ptys[0]?.fail(new TypeError('Native terminal completion failed'))

    await expect.poll(() => socket.closed).toBe(true)
    expect(socket.messages.some((message) => message.type === 'error')).toBe(true)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(true)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(1)
    expect(fixture.engine.worktreeExecutionGate.tryAcquireExclusive(worktreeId)).toEqual({
      acquired: false,
      reason: 'active-terminal',
    })
    // Dispose detaches; a service that already failed native cleanup still forgets the session.
    await service.dispose()
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(false)
  })

  it('ends a requested lease when cleanup already holds the execution gate', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const exclusive = fixture.engine.worktreeExecutionGate.tryAcquireExclusive(worktreeId)
    expect(exclusive.acquired).toBe(true)
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const socket = fakeSocket(root, '')
    await service.routes(auth()).open(socket)
    expect(socket.closed).toBe(true)
    expect(pty.spawns).toHaveLength(0)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(0)
    expect([...(await fixture.engine.readModelSnapshot()).terminalLeases.values()][0]?.state).toBe(
      'ended',
    )
    if (exclusive.acquired) exclusive.release()
  })

  it('never spawns for a socket closed while its durable lease is being claimed', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const claimed = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const pty = createFakePtyFactory()
    const service = testService(root, {
      ptyFactory: pty.factory,
      lifecycle: {
        begin: async (id) => {
          const lease = await fixture.engine.beginTerminalLease(id)
          claimed.resolve()
          await resume.promise
          return lease
        },
      },
    })
    const routes = service.routes(auth())
    const socket = fakeSocket(root, '')
    const opening = routes.open(socket)
    await claimed.promise
    routes.close(socket)
    resume.resolve()
    await opening
    expect(pty.spawns).toHaveLength(0)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(0)
  })

  it('ends an immediately completed PTY without activating its ended lease', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const pty = createFakePtyFactory({ immediateExit: 0 })
    const service = testService(root, { ptyFactory: pty.factory })
    const socket = fakeSocket(root, '')
    await service.routes(auth()).open(socket)

    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    const exitIndex = socket.messages.findIndex((message) => message.type === 'exit')
    expect(exitIndex).toBeGreaterThanOrEqual(0)
    expect(socket.messages.slice(exitIndex + 1).some((message) => message.type === 'ready')).toBe(
      false,
    )
    expect([...(await fixture.engine.readModelSnapshot()).terminalLeases.values()][0]?.state).toBe(
      'ended',
    )
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(0)
  })

  it('reconnects to the same native shell after eleven detached minutes', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const service = testService(root, {
      env: { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh' },
      ptyFactory: host.factory,
    })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '', 'native-retained-job')
    await routes.open(first)
    routes.message(first, new TextEncoder().encode('RETAINED_JOB=survived; echo READY_TO_DETACH\n'))
    await waitForTerminalOutput(first.messages, 'READY_TO_DETACH\r\n')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      routes.close(first)
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    } finally {
      vi.useRealTimers()
    }
    const second = fakeSocket(root, '', 'native-retained-job')
    await routes.open(second)
    routes.message(second, new TextEncoder().encode('printf "retained:%s\\n" "$RETAINED_JOB"\n'))
    await waitForTerminalOutput(second.messages, 'retained:survived')
    await service.dispose()
  })

  it('restores raw history after service restart', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const firstService = testService(root, { ptyFactory: pty.factory })
    const first = fakeSocket(root, '', 'restart-history')
    await firstService.routes(auth()).open(first)
    const bytes = new Uint8Array([0xff, 0, 0xf0, 0x9f, 0x98, 0x80])
    pty.ptys[0]?.emit(bytes)
    await firstService.dispose()
    expect(pty.ptys[0]?.killed).toBe(false)
    const secondService = testService(root, { ptyFactory: pty.factory })
    const second = fakeSocket(root, '', 'restart-history')
    await secondService.routes(auth()).open(second)
    expect(pty.ptys).toHaveLength(2)
    expect(terminalOutputBytes(second.messages)).toEqual(bytes)
    expect(second.messages).toContainEqual(
      expect.objectContaining({ type: 'ready', restoredHistory: true }),
    )
  })

  it('clears all viewers and persisted replay without ending the process', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '', 'shared-clear')
    const second = fakeSocket(root, '', 'shared-clear')
    await routes.open(first)
    await routes.open(second)
    pty.ptys[0]?.emit(Buffer.from('private output'))
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    await service.clear({ worktreeId, terminalId: 'shared-clear' })
    expect(first.messages.at(-1)).toEqual({ type: 'cleared' })
    expect(second.messages.at(-1)).toEqual({ type: 'cleared' })
    expect(pty.ptys[0]?.killed).toBe(false)
    expect(pty.ptys[0]?.writes).toContain('\f')
    const third = fakeSocket(root, '', 'shared-clear')
    await routes.open(third)
    expect(terminalOutputBytes(third.messages)).toHaveLength(0)
    pty.ptys[0]?.emit(Buffer.from('new output'))
    await service.kill({ worktreeId, terminalId: 'shared-clear' })
    const reopened = fakeSocket(root, '', 'shared-clear')
    await routes.open(reopened)
    expect(terminalOutputBytes(reopened.messages)).toHaveLength(0)
    expect(reopened.messages[0]).toMatchObject({ type: 'ready', restoredHistory: false })
  })

  it('serializes clear behind an opening terminal so stale history cannot return', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const firstService = testService(root, { ptyFactory: pty.factory })
    await firstService.routes(auth()).open(fakeSocket(root, '', 'opening-clear'))
    pty.ptys[0]?.emit(Buffer.from('old output'))
    await firstService.dispose()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const fixture = requiredFixture(root)
    const service = testService(root, {
      ptyFactory: pty.factory,
      lifecycle: {
        begin: async (id) => {
          entered.resolve()
          await release.promise
          return fixture.engine.beginTerminalLease(id)
        },
      },
    })
    const routes = service.routes(auth())
    const socket = fakeSocket(root, '', 'opening-clear')
    const opening = routes.open(socket)
    await entered.promise
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const clearing = service.clear({ worktreeId, terminalId: 'opening-clear' })
    release.resolve()
    await Promise.all([opening, clearing])
    expect(socket.messages.at(-1)).toEqual({ type: 'cleared' })
    pty.ptys[1]?.emit(Buffer.from('after clear'))
    const next = fakeSocket(root, '', 'opening-clear')
    await routes.open(next)
    expect(terminalOutputText(next.messages)).toBe('after clear')
  })

  it('reports failed history cleanup instead of claiming kill succeeded', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    await routes.open(fakeSocket(root, '', 'failed-delete'))
    pty.ptys[0]?.emit(Buffer.from('retained until cleanup'))
    fixture.sqlite.run(
      "CREATE TRIGGER refuse_history_delete BEFORE DELETE ON terminal_history_chunks BEGIN SELECT RAISE(ABORT, 'history cleanup failed'); END",
    )
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    try {
      await expect(service.kill({ worktreeId, terminalId: 'failed-delete' })).rejects.toMatchObject(
        { code: 'terminal.CLEANUP_UNCONFIRMED' },
      )
    } finally {
      fixture.sqlite.run('DROP TRIGGER refuse_history_delete')
    }
    await routes.open(fakeSocket(root, '', 'failed-delete'))
    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    const reopened = fakeSocket(root, '', 'failed-delete')
    await routes.open(reopened)
    expect(terminalOutputBytes(reopened.messages)).toHaveLength(0)
  })

  it('does not scan completed agent history again after a service restart', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
    await testService(root).closeSessionTerminals(sessionId)
    fixture.sqlite.run(
      "CREATE TRIGGER detect_history_scan BEFORE DELETE ON terminal_history_chunks BEGIN SELECT RAISE(ABORT, 'history scanned again'); END",
    )
    fixture.database
      .insert(terminalHistoryChunks)
      .values({
        owner: JSON.stringify(['other-worktree', 'agent', sessionId]),
        sequence: 1,
        data: Buffer.from('scan detector'),
      })
      .run()
    try {
      await expect(testService(root).closeSessionTerminals(sessionId)).resolves.toEqual({
        closed: 0,
      })
    } finally {
      fixture.sqlite.run('DROP TRIGGER detect_history_scan')
    }
  })

  it('refuses an agent terminal whose open was in flight when the session was cleaned up', async () => {
    const root = await fixtureRoot()
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000002')
    const pty = createFakePtyFactory()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const service = testService(root, {
      ptyFactory: pty.factory,
      resolveAgentSession: async () => {
        entered.resolve()
        await release.promise
        return { command: ['agent'], env: {}, release() {}, async reconcile() {} }
      },
    })
    const socket = fakeSocket(root, '', 'agent-racing-delete')
    const agentSocket = {
      ...socket,
      data: { ...socket.data, query: { ...socket.data.query, agentSessionId: sessionId } },
    }
    const opening = service.routes(auth()).open(agentSocket)
    await entered.promise
    await expect(service.closeSessionTerminals(sessionId)).resolves.toEqual({ closed: 0 })
    release.resolve()
    await opening
    expect(pty.ptys).toHaveLength(0)
    expect(agentSocket.closeDetails).toEqual({ code: 1008, reason: 'session-deleted' })
  })

  it('refuses unconfirmed agent cleanup and preserves history until retry succeeds', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
    const pty = createFakePtyFactory()
    let failReconcile = true
    const service = testService(root, {
      ptyFactory: pty.factory,
      resolveAgentSession: async () => ({
        command: ['agent'],
        env: {},
        release() {},
        async reconcile() {
          if (failReconcile) throw new Error('reconciliation failed')
        },
      }),
    })
    const socket = fakeSocket(root, '', 'agent-cleanup')
    const agentSocket = {
      ...socket,
      data: { ...socket.data, query: { ...socket.data.query, agentSessionId: sessionId } },
    }
    await service.routes(auth()).open(agentSocket)
    expect(pty.ptys).toHaveLength(1)
    pty.ptys[0]!.emit(Buffer.from('retained agent output'))
    await expect(service.closeSessionTerminals(sessionId)).rejects.toMatchObject({
      code: 'terminal.CLEANUP_UNCONFIRMED',
    })
    expect(fixture.database.select().from(terminalHistoryChunks).all()).not.toHaveLength(0)
    failReconcile = false
    await expect(service.closeSessionTerminals(sessionId)).resolves.toEqual({ closed: 1 })
    expect(fixture.database.select().from(terminalHistoryChunks).all()).toHaveLength(0)
  })

  it('restarts only the selected shell, preserves viewers and dimensions, and removes old replay', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '', 'restart-target')
    const second = fakeSocket(root, '', 'restart-target')
    const other = fakeSocket(root, '', 'other-target')
    await routes.open(first)
    await routes.open(second)
    await routes.open(other)
    pty.ptys[0]?.emit(Buffer.from('before restart'))
    routes.message(first, { type: 'resize', cols: 100, rows: 35 })
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    await expect(service.restart({ worktreeId, terminalId: 'restart-target' })).resolves.toEqual({
      restarted: true,
    })
    expect(pty.ptys).toHaveLength(3)
    expect(pty.ptys[0]?.killed).toBe(true)
    expect(pty.ptys[1]?.killed).toBe(false)
    expect(pty.spawns[2]).toMatchObject({ cols: 100, rows: 35 })
    expect(first.closed).toBe(false)
    expect(second.closed).toBe(false)
    expect(first.messages.filter((message) => message.type === 'cleared')).toHaveLength(1)
    expect(second.messages.filter((message) => message.type === 'cleared')).toHaveLength(1)
    expect(first.messages.some((message) => message.type === 'exit')).toBe(false)
    for (const viewer of [first, second]) {
      const cleared = viewer.messages.findIndex((message) => message.type === 'cleared')
      const replacement = viewer.messages.slice(cleared + 1)
      expect(replacement.filter((message) => message.type === 'replay-complete')).toHaveLength(1)
      expect(replacement.findIndex((message) => message.type === 'ready')).toBeLessThan(
        replacement.findIndex((message) => message.type === 'replay-complete'),
      )
    }
    routes.message(second, Buffer.from('replacement input'))
    expect(pty.ptys[2]?.writes).toContainEqual(Buffer.from('replacement input'))
    pty.ptys[2]?.emit(Buffer.from('replacement output'))
    const third = fakeSocket(root, '', 'restart-target')
    await routes.open(third)
    expect(terminalOutputText(third.messages)).toBe('replacement output')
    expect(
      requireWorktree(await requiredFixture(root).engine.readModelSnapshot(), worktreeId)
        .activeTerminalCount,
    ).toBe(2)
  })

  it('restarts an exited detached terminal immediately without requiring a viewer', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '', 'detached-restart')
    await routes.open(first)
    routes.close(first)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    await service.restart({ worktreeId, terminalId: 'detached-restart' })
    expect(pty.ptys).toHaveLength(2)
    expect(pty.ptys[0]?.killed).toBe(true)
    expect(pty.ptys[1]?.killed).toBe(false)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(true)
  })

  it('replaces a real native shell without disconnecting its viewer', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const service = testService(root, {
      env: { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh' },
      ptyFactory: host.factory,
    })
    const routes = service.routes(auth())
    const socket = fakeSocket(root, '', 'native-restart')
    await routes.open(socket)
    routes.message(
      socket,
      Buffer.from('RESTART_TOKEN=old; printf "before:%s\\n" "$RESTART_TOKEN"\n'),
    )
    await waitForTerminalOutput(socket.messages, 'before:old')
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    await service.restart({ worktreeId, terminalId: 'native-restart' })
    expect(socket.closed).toBe(false)
    expect(socket.messages.filter((message) => message.type === 'ready')).toHaveLength(2)
    routes.message(socket, Buffer.from('printf "after:%s\\n" "${RESTART_TOKEN-unset}"\n'))
    await waitForTerminalOutput(socket.messages, 'after:unset')
    await service.dispose()
  })

  it('spawns a native shell beneath the terminal host and streams its output', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const service = testService(root, {
      env: {
        HOME: root,
        PATH: process.env.PATH,
        SHELL: '/bin/sh',
      },
      ptyFactory: host.factory,
    })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '')

    await routes.open(ws)
    routes.message(
      ws,
      new TextEncoder().encode('printf \'\\137\\137PTY_PARENT:%s\\137\\137\\n\' "$PPID"; exit\n'),
    )

    const hostPid = (await host.client.host()).pid
    await waitForTerminalOutput(ws.messages, `__PTY_PARENT:${hostPid}__`)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    expect(ws.messages.at(-1)).toEqual({ type: 'exit', exitCode: 0 })
    expect(hostPid).not.toBe(process.pid)
  })

  it('detaches every session on dispose, leaving the shell alive in the host', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const service = testService(root, {
      env: { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh' },
      hostClient: host.client,
    })
    const routes = service.routes(auth())
    const socket = fakeSocket(root, '', 'detach-term')
    await routes.open(socket)
    routes.message(socket, Buffer.from('printf "PID:%s\\n" "$$"\n'))
    await waitForTerminalOutput(socket.messages, 'PID:')

    await service.dispose()

    const sessions = await host.connect().list()
    expect(sessions.filter((session) => !session.exited)).toHaveLength(1)
  })

  it.each(['after recovery', 'during recovery', 'after clearing history'] as const)(
    'preserves the shell when a browser reconnects %s',
    async (timing) => {
      const root = await fixtureRoot()
      const host = await nativeHost()
      const env = { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh' }
      const serviceA = testService(root, { env, hostClient: host.client })
      const routesA = serviceA.routes(auth())
      const socketA = fakeSocket(root, '', 'reattach-term')
      await routesA.open(socketA)
      routesA.message(socketA, Buffer.from('printf "PID:%s\\n" "$$"\n'))
      await waitForTerminalOutput(socketA.messages, 'PID:')
      const pid = terminalOutputText(socketA.messages).match(/PID:(\d+)/)?.[1]
      if (!pid) throw new TypeError('Missing pid marker in the first shell output')

      if (timing === 'after clearing history') {
        await serviceA.clear({
          worktreeId: v.parse(worktreeIdSchema, registrations.get(root)),
          terminalId: 'reattach-term',
        })
      }
      await serviceA.dispose()

      const serviceB = testService(root, { env, hostClient: host.connect() })
      const recovering = serviceB.reattach()
      if (timing === 'after recovery') await recovering
      const routesB = serviceB.routes(auth())
      const socketB = fakeSocket(root, '', 'reattach-term')
      await Promise.all([recovering, routesB.open(socketB)])
      // Replayed from the persisted history, not from a fresh spawn.
      if (timing !== 'after clearing history')
        await waitForTerminalOutput(socketB.messages, `PID:${pid}`)
      // Shells without line editing leave Clear's form feed in the pending input.
      routesB.message(socketB, Buffer.from('\u0015printf "PID2:%s\\n" "$$"\n'))
      await waitForTerminalOutput(socketB.messages, `PID2:${pid}`)
      if (timing === 'after clearing history')
        expect(terminalOutputText(socketB.messages)).not.toContain(`PID:${pid}`)
    },
  )

  it('continues recovery and admits terminal operations after one lease attachment fails', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const env = { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh' }
    const first = testService(root, { env, hostClient: host.client })
    await first.routes(auth()).open(fakeSocket(root, '', 'failed'))
    await first.routes(auth()).open(fakeSocket(root, '', 'survived'))
    await first.dispose()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const next = testService(root, {
      env,
      hostClient: host.connect(),
      resolveAdoptedLease: async (key) => {
        if (key === terminalSessionKey(worktreeId, 'failed'))
          throw new TypeError('Recovery fixture failure')
        return fixtures.get(root)!.engine.adoptedLeaseForKey(key)
      },
    })
    await expect(next.reattach()).resolves.toBeUndefined()
    expect(next.hasWorktreeRuntime(worktreeId)).toBe(true)
    await expect(next.clear({ worktreeId, terminalId: 'failed' })).resolves.toEqual({
      cleared: true,
    })
    const socket = fakeSocket(root, '', 'new-terminal')
    await next.routes(auth()).open(socket)
    expect(socket.messages.some((message) => message.type === 'ready')).toBe(true)
  })

  it('keeps the same unreachable host snapshot for lease adoption and orphan recovery', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const shell = await host.client.spawn({
      key: terminalSessionKey(worktreeId, 'unknown'),
      command: ['/bin/sh'],
      onData: () => {},
    })
    host.client.close()
    const token = await readFile(host.paths.token)
    const service = testService(root, { hostClient: host.connect() })
    await writeFile(host.paths.token, 'wrong-token')
    expect(await service.listHostSessions()).toBeNull()
    await writeFile(host.paths.token, token)
    await service.reattach()
    const observer = host.connect()
    expect((await observer.list()).map((info) => info.pid)).toContain(shell.pid)
    await Bun.sleep(50)
    expect((await observer.list()).find((info) => info.pid === shell.pid)?.exited).toBe(false)
  })

  it('forgets an exited host session after recovery confirms it has no lease', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const exitFile = path.join(host.paths.directory, 'exit')
    await host.client.spawn({
      key: terminalSessionKey(worktreeId, 'exited'),
      command: ['/bin/sh', '-c', 'while [ ! -f "$1" ]; do sleep 0.01; done', 'sh', exitFile],
      onData: () => {},
    })
    host.client.close()
    const observer = host.connect()
    await observer.list()
    await writeFile(exitFile, '')
    await expect.poll(async () => (await observer.list())[0]?.exited).toBe(true)
    const service = testService(root, { hostClient: host.connect() })
    await service.reattach()
    await expect.poll(() => observer.list()).toEqual([])
  })

  it('saves the final output of a real shell that exited while the server was down', async () => {
    const root = await fixtureRoot()
    const host = await nativeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const key = terminalSessionKey(worktreeId, 'exited-native')
    const exitFile = path.join(host.paths.directory, 'exit')
    await host.client.spawn({
      key,
      command: [
        '/bin/sh',
        '-c',
        'while [ ! -f "$1" ]; do sleep 0.01; done; echo LAST_WORDS',
        'sh',
        exitFile,
      ],
      onData: () => {},
    })
    host.client.close()
    const observer = host.connect()
    await observer.list()
    await writeFile(exitFile, '')
    await expect.poll(async () => (await observer.list())[0]?.exited).toBe(true)
    const service = testService(root, { hostClient: host.connect() })

    await service.reattach()

    const history = new TerminalHistory(requiredFixture(root).database, key)
    expect(Buffer.concat(history.values()).toString()).toContain('LAST_WORDS')
    await expect.poll(() => observer.list()).toEqual([])
  })

  it('keeps streaming a shell after the host connection drops', async () => {
    const root = await fixtureRoot()
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const service = testService(root, { hostClient: host.connect() })
    const socket = fakeSocket(root, '', 'dropped')
    await service.routes(auth()).open(socket)
    const [session] = host.sessions.values()
    host.write(session!.session, 'before-drop;')
    await waitForTerminalOutput(socket.messages, 'before-drop;')

    host.drop()
    host.write(session!.session, 'after-drop;')

    await waitForTerminalOutput(socket.messages, 'after-drop;')
    expect(socket.closed).toBe(false)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(true)
  })

  it('marks ownership unknown and forgets the session when the host cannot be reached again', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const service = testService(root, { hostClient: host.connect() })
    const socket = fakeSocket(root, '', 'stranded')
    await service.routes(auth()).open(socket)

    await host.stop()

    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    expect(socket.closed).toBe(true)
    expect([...(await fixture.engine.readModelSnapshot()).terminalLeases.values()][0]?.state).toBe(
      'ownership-unknown',
    )
    expect(fixture.engine.worktreeExecutionGate.tryAcquireExclusive(worktreeId).acquired).toBe(true)
  })

  it('starts a fresh shell on reopen after the host connection was lost', async () => {
    const root = await fixtureRoot()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const pty = createFakePtyFactory({ holdUntilExit: true })
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    await routes.open(fakeSocket(root, '', 'lost'))

    pty.ptys[0]?.fail(terminalHostErrors.HOST_UNREACHABLE({ internal: { reason: 'test' } }))
    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    const reopened = fakeSocket(root, '', 'lost')
    await routes.open(reopened)

    expect(pty.spawns).toHaveLength(2)
    expect(reopened.messages.some((message) => message.type === 'ready')).toBe(true)
  })

  it('saves the final output of a shell that exited while the server was down', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const key = terminalSessionKey(worktreeId, 'exited-offline')
    new TerminalHistory(fixture.database, key).append(Buffer.from('seen;'), 5)
    const session = host.add(key, 'seen;last words;')
    host.exit(session.session, 0)
    const service = testService(root, { hostClient: host.connect() })

    await service.reattach()

    const history = new TerminalHistory(fixture.database, key)
    expect(Buffer.concat(history.values()).toString()).toBe('seen;last words;')
    expect(history.offset).toBe(16)
    expect(host.sessions.size).toBe(0)
  })

  it('kills the host session and ends its lease when reattaching fails', async () => {
    const root = await fixtureRoot()
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const session = host.add(terminalSessionKey(worktreeId, 'unattachable'))
    host.refused.add('attach')
    const lease = recordingLease()
    const service = testService(root, {
      hostClient: host.connect(),
      resolveAdoptedLease: async () => lease,
    })

    await service.reattach()

    await expect
      .poll(() => host.received)
      .toContainEqual({ type: 'kill', session: session.session })
    expect(lease.ended).toBe(1)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(false)
  })

  it('kills the host session when its recovery throws', async () => {
    const root = await fixtureRoot()
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const session = host.add(terminalSessionKey(worktreeId, 'throws'))
    const service = testService(root, {
      hostClient: host.connect(),
      resolveAdoptedLease: async () => {
        throw new TypeError('Recovery fixture failure')
      },
    })

    await service.reattach()

    await expect
      .poll(() => host.received)
      .toContainEqual({ type: 'kill', session: session.session })
  })

  it("closes a deleted session's agent shell that the host kept across a restart", async () => {
    const root = await fixtureRoot()
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000003')
    const session = host.add(terminalSessionKey(worktreeId, sessionId, sessionId), 'agent;')
    const lease = recordingLease()
    const service = testService(root, {
      hostClient: host.connect(),
      resolveAdoptedLease: async () => lease,
    })

    // Recovery is still running when the deletion arrives.
    const recovering = service.reattach()
    await expect(service.closeSessionTerminals(sessionId)).resolves.toEqual({ closed: 1 })
    await recovering

    expect(host.received).toContainEqual(
      expect.objectContaining({ type: 'kill', session: session.session }),
    )
    expect(lease.ended).toBe(1)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(false)
  })

  it('deletes the output an exited agent shell saves during recovery, with its stream offset', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000004')
    const key = terminalSessionKey(worktreeId, sessionId, sessionId)
    new TerminalHistory(fixture.database, key).append(Buffer.from('seen;'), 5)
    host.exit(host.add(key, 'seen;last words;').session, 0)
    const service = testService(root, { hostClient: host.connect() })

    const recovering = service.reattach()
    await expect(service.closeSessionTerminals(sessionId)).resolves.toEqual({ closed: 0 })
    await recovering

    expect(fixture.database.select().from(terminalHistoryChunks).all()).toEqual([])
    expect(fixture.database.select().from(terminalSessionOffsets).all()).toEqual([])
    expect(host.sessions.size).toBe(0)
  })

  it("kills a deleted session's agent shells that recovery skipped for want of a host listing", async () => {
    const root = await fixtureRoot()
    const host = await fakeHost()
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000005')
    const agent = host.add(terminalSessionKey(worktreeId, sessionId, sessionId))
    const shell = host.add(terminalSessionKey(worktreeId, 'worktree-shell'))
    const service = testService(root, { hostClient: host.connect() })
    host.refused.add('list')
    expect(await service.listHostSessions()).toBeNull()
    host.refused.delete('list')

    await expect(service.closeSessionTerminals(sessionId)).resolves.toEqual({ closed: 1 })

    await expect.poll(() => host.received).toContainEqual({ type: 'kill', session: agent.session })
    expect(host.received).not.toContainEqual({ type: 'kill', session: shell.session })
  })
})

// Shells run in a real terminal host in a throwaway state root.
async function nativeHost() {
  const host = await createTestTerminalHost()
  hosts.push(host)
  return host
}

// Speaks the host protocol in-process, so recovery runs without a native PTY.
async function fakeHost() {
  const host = await createFakeTerminalHost()
  fakeHosts.push(host)
  return host
}

function recordingLease() {
  const lease = {
    terminalLeaseId: v.parse(terminalLeaseIdSchema, crypto.randomUUID()),
    runtimeEpoch: 'recording',
    ended: 0,
    activate: async () => {},
    terminate: async () => {},
    end: async () => {
      lease.ended += 1
    },
    markUnknown: async () => {},
  }
  return lease
}

function testService(
  root: string,
  options: {
    beforeWorktreeResolution?: Promise<void>
    env?: NodeJS.ProcessEnv
    foregroundProcess?: (pid: number) => Promise<string | null>
    paths?: WorkspacePaths
    processPollMs?: number
    ptyFactory?: TerminalPtyFactory
    resolveAgentSession?: import('../agent-launch').AgentTerminalResolver
    lifecycle?: import('../lease').TerminalLeaseBoundary
    hostClient?: import('../host-client').TerminalHostClient
    resolveAdoptedLease?: TerminalServiceOptions['resolveAdoptedLease']
  } = {},
) {
  const fixture = fixtures.get(root)
  if (!fixture) throw new TypeError('Missing fixture')
  const { beforeWorktreeResolution, ...serviceOptions } = options
  const service = new TerminalService({
    database: fixture.database,
    paths: createWorkspacePaths(root),
    resolveWorktree: async (id) => {
      await beforeWorktreeResolution
      return requireWorktree(await fixture.engine.readModelSnapshot(), id).canonicalPath
    },
    lifecycle: { begin: (id, key) => fixture.engine.beginTerminalLease(id, key) },
    resolveAdoptedLease: (key) => fixture.engine.adoptedLeaseForKey(key),
    ...serviceOptions,
  })
  services.push(service)
  return service
}

async function fixtureRoot() {
  const fixture = await createOrchestrationFixture()
  const root = fixture.checkout
  fixtures.set(root, fixture)
  await mkdir(path.join(root, 'project'))
  for (const checkout of [root, path.join(root, 'project')]) {
    const result = (await fixture.register(checkout)).result
    if (!result) throw new TypeError('Missing registration')
    registrations.set(checkout, result.worktreeId)
  }
  return root
}

function auth() {
  return createAuthConfig({ allowedOrigins: [TRUSTED_ORIGIN] })
}

function processNames(messages: readonly TerminalServerMessage[]) {
  return messages.flatMap((message) => (message.type === 'process' ? [message.name] : []))
}

function fakeSocket(
  root: string,
  subdirectory: string,
  session = 'terminal-default',
  origin: string = TRUSTED_ORIGIN,
) {
  const messages: TerminalServerMessage[] = []
  const closeDetails: { code: number | undefined; reason: string | undefined } = {
    code: undefined,
    reason: undefined,
  }
  const raw = {}
  return {
    closed: false,
    closeDetails,
    data: {
      headers: { origin },
      query: { worktreeId: registrations.get(path.join(root, subdirectory)), terminalId: session },
    },
    messages,
    raw,
    close(code?: number, reason?: string) {
      this.closed = true
      this.closeDetails = { code, reason }
    },
    send(message: string | Uint8Array) {
      const parsed = parseTerminalServerMessage(message)
      if (!parsed) throw new TypeError('Invalid terminal frame')
      messages.push(parsed)
    },
  }
}

async function waitForTerminalOutput(messages: readonly TerminalServerMessage[], text: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (terminalOutputText(messages).includes(text)) return

    await Bun.sleep(25)
  }

  throw new TypeError(
    `Timed out waiting for terminal output: ${text}; received ${JSON.stringify(terminalOutputText(messages))}`,
  )
}

function observedLogDir(root: string) {
  const logDir = path.join(requiredFixture(root).root, 'logs')
  initializeObservability({
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
  })
  return logDir
}

async function terminalSessionEvents(logDir: string) {
  await flushObservability()
  const events: WideEvent[] = []
  for await (const event of readFsLogs({ dir: logDir })) {
    if (event.action === 'terminal.session') events.push(event)
  }
  return events
}

function requiredFixture(root: string) {
  const fixture = fixtures.get(root)
  if (!fixture) throw new TypeError('Missing fixture')
  return fixture
}
