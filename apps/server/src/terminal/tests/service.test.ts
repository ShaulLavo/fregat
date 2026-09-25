import * as v from 'valibot'
import { terminalHistoryChunks } from '../../db/schema'
import { mkdir, realpath, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElysiaWS } from 'elysia/ws'
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MIN_ROWS,
  parseTerminalServerMessage,
  type TerminalServerMessage,
  worktreeIdSchema,
  sessionIdSchema,
} from '@workspace/contracts'

import { createOrchestrationFixture } from '../../../test/factories/orchestration'
import {
  createFakePtyFactory,
  terminalOutputBytes,
  terminalOutputText,
} from '../../../test/factories/terminal'
import { requireWorktree } from '../../orchestration/read-model'
import { projectionTerminalLeases } from '../../db/schema'
import { createAuthConfig } from '../../auth'
import { createWorkspacePaths, type WorkspacePaths } from '../../fs/path'
import { TerminalService, type TerminalPtyFactory } from '../service'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const fixtures = new Map<string, Awaited<ReturnType<typeof createOrchestrationFixture>>>()
const registrations = new Map<string, string>()
const services: TerminalService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
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

  it('keeps the PTY alive on socket close and kills it on disposal', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '')

    await routes.open(ws)
    routes.close(ws)

    expect(pty.ptys).toHaveLength(1)
    expect(pty.ptys[0]?.killed).toBe(false)

    await service.dispose()

    expect(pty.ptys[0]?.killed).toBe(true)
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
    expect(pty.ptys[0]?.killed).toBe(true)
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
    expect(pty.ptys[0]?.killed).toBe(true)
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

  it('keeps its durable lease and gate through detach and kill without positive exit', async () => {
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
    let disposed = false
    const disposal = service.dispose().then(() => {
      disposed = true
    })
    await expect.poll(() => pty.ptys[0]?.killed).toBe(true)
    expect(disposed).toBe(false)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(true)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(1)
    expect([...(await fixture.engine.readModelSnapshot()).terminalLeases.values()][0]?.state).toBe(
      'termination-requested',
    )
    pty.ptys[0]?.exit(0)
    await disposal
    expect(disposed).toBe(true)
    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    expect(
      requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).activeTerminalCount,
    ).toBe(0)
    const exclusive = fixture.engine.worktreeExecutionGate.tryAcquireExclusive(worktreeId)
    expect(exclusive.acquired).toBe(true)
    if (exclusive.acquired) exclusive.release()
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
    await service.dispose()
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(true)
  })

  it('waits for the durable lease to end after native child completion during disposal', async () => {
    const root = await fixtureRoot()
    const fixture = requiredFixture(root)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    const pty = createFakePtyFactory({ holdUntilExit: true })
    const ending = Promise.withResolvers<void>()
    const finishEnd = Promise.withResolvers<void>()
    const service = testService(root, {
      ptyFactory: pty.factory,
      lifecycle: {
        begin: async (id) => {
          const lease = await fixture.engine.beginTerminalLease(id)
          return {
            ...lease,
            end: async () => {
              ending.resolve()
              await finishEnd.promise
              await lease.end()
            },
          }
        },
      },
    })
    await service.routes(auth()).open(fakeSocket(root, ''))
    let disposed = false
    const disposal = service.dispose().then(() => {
      disposed = true
    })
    await expect.poll(() => pty.ptys[0]?.killed).toBe(true)
    pty.ptys[0]?.exit(0)
    await ending.promise

    expect(disposed).toBe(false)
    expect(service.hasWorktreeRuntime(worktreeId)).toBe(true)
    finishEnd.resolve()
    await disposal
    expect(disposed).toBe(true)
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
    const service = testService(root, {
      env: { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh' },
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

  it('restores raw history after service restart without retaining the old process', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const firstService = testService(root, { ptyFactory: pty.factory })
    const first = fakeSocket(root, '', 'restart-history')
    await firstService.routes(auth()).open(first)
    const bytes = new Uint8Array([0xff, 0, 0xf0, 0x9f, 0x98, 0x80])
    pty.ptys[0]?.emit(bytes)
    await firstService.dispose()
    expect(pty.ptys[0]?.killed).toBe(true)
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
    const service = testService(root, {
      env: { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh' },
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

  it('spawns a native shell directly beneath the server and streams its output', async () => {
    const root = await fixtureRoot()
    const service = testService(root, {
      env: {
        HOME: root,
        PATH: process.env.PATH,
        SHELL: '/bin/sh',
      },
    })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '')

    await routes.open(ws)
    routes.message(
      ws,
      new TextEncoder().encode('printf \'\\137\\137PTY_PARENT:%s\\137\\137\\n\' "$PPID"; exit\n'),
    )

    await waitForTerminalOutput(ws.messages, `__PTY_PARENT:${process.pid}__`)
    const worktreeId = v.parse(worktreeIdSchema, registrations.get(root))
    await expect.poll(() => service.hasWorktreeRuntime(worktreeId)).toBe(false)
    expect(ws.messages.at(-1)).toEqual({ type: 'exit', exitCode: 0 })
    expect(terminalOutputText(ws.messages)).toContain(`__PTY_PARENT:${process.pid}__`)
  })
})

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
    lifecycle: { begin: (id) => fixture.engine.beginTerminalLease(id) },
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

  throw new TypeError(`Timed out waiting for terminal output: ${text}`)
}

function requiredFixture(root: string) {
  const fixture = fixtures.get(root)
  if (!fixture) throw new TypeError('Missing fixture')
  return fixture
}
