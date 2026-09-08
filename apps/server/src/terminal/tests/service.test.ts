import * as v from 'valibot'
import { mkdir, realpath, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ElysiaWS } from 'elysia/ws'
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MIN_ROWS,
  parseTerminalServerMessage,
  type TerminalServerMessage,
  worktreeIdSchema,
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
    expect(Buffer.isBuffer(frames[1])).toBe(true)
    expect(frames[1]).toEqual(Buffer.from([0xff, 0x00, 0x80]))
  })

  it('keeps exactly the latest 256 KiB for replay even after one oversized chunk', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const first = fakeSocket(root, '')
    await routes.open(first)
    const oversized = Uint8Array.from({ length: 256 * 1024 + 31 }, (_, index) => index % 251)
    const tail = new Uint8Array([0xff, 0x80, 0x00])

    pty.ptys[0]?.emit(oversized)
    pty.ptys[0]?.emit(tail)
    routes.close(first)
    const second = fakeSocket(root, '')
    await routes.open(second)

    expect(terminalOutputBytes(first.messages).length).toBe(oversized.length + tail.length)
    const replay = terminalOutputBytes(second.messages)
    expect(replay.length).toBe(256 * 1024)
    expect(replay.subarray(0, -tail.length)).toEqual(oversized.subarray(31 + tail.length))
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
    const service = testService(root, { ptyFactory: pty.factory, detachTtlMs: 0 })
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
    await expect.poll(() => pty.ptys[0]?.killed).toBe(true)
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
    const bytes = new TextEncoder().encode('😀' + 'x'.repeat(256 * 1024 - 2))
    pty.ptys[0]?.emit(bytes.subarray(0, 3))
    pty.ptys[0]?.emit(bytes.subarray(3))
    const second = fakeSocket(root, '')
    await routes.open(second)

    expect(terminalOutputText(first.messages)).toBe('😀' + 'x'.repeat(256 * 1024 - 2))
    expect(terminalOutputText(second.messages)).toBe('x'.repeat(256 * 1024 - 2))
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

  it('kills the PTY when a detached session exceeds its idle TTL', async () => {
    const root = await fixtureRoot()
    const pty = createFakePtyFactory()
    const service = testService(root, { detachTtlMs: 0, ptyFactory: pty.factory })
    const routes = service.routes(auth())
    const ws = fakeSocket(root, '')

    await routes.open(ws)
    routes.close(ws)
    await Bun.sleep(10)

    expect(pty.ptys[0]?.killed).toBe(true)
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
    detachTtlMs?: number
    env?: NodeJS.ProcessEnv
    paths?: WorkspacePaths
    ptyFactory?: TerminalPtyFactory
    lifecycle?: import('../lease').TerminalLeaseBoundary
  } = {},
) {
  const fixture = fixtures.get(root)
  if (!fixture) throw new TypeError('Missing fixture')
  const { beforeWorktreeResolution, ...serviceOptions } = options
  const service = new TerminalService({
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
