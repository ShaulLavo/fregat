import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpPeer } from '../peer'
import { AcpSession } from '../session'

const executable = path.resolve(
  import.meta.dirname,
  '../../../../../../scripts/agent/fixtures/fake-acp.mjs',
)
const disposables: { dispose: () => Promise<void> }[] = []
// `bun --bun` shadows node with Bun, whose stdout retains a handle after closeSync(1).
// Resolve the real Node interpreter so the fixture independently produces physical EOF.
const nodeExecutable = resolveFixtureNode()
const input = (args: readonly string[] = []) => ({
  executable: nodeExecutable,
  args: [executable, ...args],
  cwd: import.meta.dirname,
  env: process.env,
})

function resolveFixtureNode(): string {
  if (!process.versions.bun) return process.execPath
  const runtime = realpathSync(process.execPath)
  const searchPath = process.env.PATH?.split(path.delimiter)
    .filter((directory) => {
      const candidate = path.join(directory, 'node')
      return !existsSync(candidate) || realpathSync(candidate) !== runtime
    })
    .join(path.delimiter)
  return execFileSync('node', ['-p', 'process.execPath'], {
    env: { ...process.env, PATH: searchPath },
    encoding: 'utf8',
  }).trim()
}
const signal = () => AbortSignal.timeout(5000)

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()))
})

describe('ACP fixture transport gate', () => {
  it('correlates concurrent RPCs and refuses provider errors without exposing their messages', async () => {
    const peer = new AcpPeer(input())
    disposables.push(peer)
    const results = await Promise.all([
      peer.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal()),
      peer.request('session/new', {}, signal()),
    ])
    expect(results[0]).toMatchObject({ protocolVersion: 1 })
    expect(results[1]).toHaveProperty('sessionId')
    await expect(peer.request('fixture/error', {}, signal())).rejects.toMatchObject({
      message: 'The agent could not complete the request.',
    })
  })

  it('rejects a pending request on abort and still answers another request', async () => {
    const peer = new AcpPeer(input())
    disposables.push(peer)
    const abort = new AbortController()
    const hung = peer.request('fixture/hang', {}, abort.signal)
    abort.abort()
    await expect(hung).rejects.toMatchObject({ message: 'The agent request was cancelled.' })
    await expect(
      peer.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal()),
    ).resolves.toMatchObject({
      protocolVersion: 1,
    })
  })

  it.each(['fixture/exit', 'fixture/malformed'])(
    'settles all pending work after %s',
    async (method) => {
      const peer = new AcpPeer(input())
      disposables.push(peer)
      const result = peer.request(method, {}, signal())
      const hung = peer.request('fixture/hang', {}, signal())
      await expect(result).rejects.toBeDefined()
      await expect(hung).rejects.toBeDefined()
    },
  )

  it.each(['load', 'resume'] as const)(
    'uses native %s and suppresses replay until its response',
    async (method) => {
      const updates: unknown[] = []
      const session = await AcpSession.open({
        ...input(),
        signal: signal(),
        resume: { sessionId: 'saved-session', method },
        onNotification: (_method, params) => updates.push(params),
      })
      disposables.push(session)
      expect(session.sessionId).toBe('saved-session')
      expect(updates).toEqual([])
      await expect(session.prompt([{ type: 'text', text: 'hello' }], signal())).resolves.toBe(
        'end_turn',
      )
      expect(updates).toHaveLength(1)
      expect(updates[0]).toMatchObject({ sessionId: 'saved-session' })
    },
  )

  it('bridges a bidirectional permission request before prompt completion', async () => {
    const requests: string[] = []
    const session = await AcpSession.open({
      ...input(),
      signal: signal(),
      onRequest: async (method) => {
        requests.push(method)
        return { outcome: { outcome: 'selected', optionId: 'yes' } }
      },
    })
    disposables.push(session)
    await expect(session.prompt([{ type: 'text', text: 'permission' }], signal())).resolves.toBe(
      'end_turn',
    )
    expect(requests).toEqual(['session/request_permission'])
  })

  it('drains cancellation, rejects overlapping prompts and isolates peer disposal', async () => {
    const first = await AcpSession.open({ ...input(), signal: signal() })
    const second = await AcpSession.open({ ...input(), signal: signal() })
    disposables.push(first, second)
    expect(first.sessionId).not.toBe(second.sessionId)
    const held = first.prompt([{ type: 'text', text: 'hold' }], signal())
    await expect(first.prompt([{ type: 'text', text: 'overlap' }], signal())).rejects.toMatchObject(
      {
        message: 'This agent is already answering.',
      },
    )
    await first.cancel()
    await expect(held).resolves.toBe('cancelled')
    await first.dispose()
    await expect(second.prompt([{ type: 'text', text: 'alive' }], signal())).resolves.toBe(
      'end_turn',
    )
  })
})

describe('ACP reviewed wire and lifecycle regressions', () => {
  it('rejects an invalid Implementation and accepts the session initializer against the pinned wire shape', async () => {
    const peer = new AcpPeer(input())
    disposables.push(peer)
    await expect(
      peer.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'missing-version' },
      }),
    ).rejects.toMatchObject({ message: 'The agent could not complete the request.' })
    const authMethods: { id: string }[] = []
    const session = await AcpSession.open({
      ...input(),
      signal: signal(),
      authenticate: (methods) => {
        authMethods.push(...methods)
        return methods[0]?.id
      },
    })
    disposables.push(session)
    expect(authMethods).toEqual([{ id: 'fixture-login', name: 'Fixture login' }])
  })

  it.each(['before-cancel', 'during-drain'] as const)(
    'retires native work on caller abort %s and refuses a replacement through the dead peer',
    async (when) => {
      const started = Promise.withResolvers<void>()
      const cancelling = Promise.withResolvers<void>()
      const session = await AcpSession.open({
        ...input(['--late-cancel', '--audit-native']),
        signal: signal(),
        onNotification: (method) => {
          if (method === 'fixture/prompt-started') started.resolve()
          if (method === 'fixture/cancel-received') cancelling.resolve()
        },
      })
      disposables.push(session)
      const controller = new AbortController()
      const held = session.prompt([{ type: 'text', text: 'hold' }], controller.signal)
      const rejected = expect(held).rejects.toMatchObject({
        message: 'The agent request was cancelled.',
      })
      await started.promise
      const drain = when === 'during-drain' ? session.cancel() : undefined
      if (when === 'during-drain') await cancelling.promise
      controller.abort()
      await rejected
      await drain
      await session.cancel()
      await expect(
        session.prompt([{ type: 'text', text: 'replacement' }], signal()),
      ).rejects.toMatchObject({ message: 'The agent connection closed.' })
      await session.dispose()
    },
  )

  it('keeps a late native cancellation response as the busy barrier until it arrives', async () => {
    const session = await AcpSession.open({ ...input(['--late-cancel']), signal: signal() })
    disposables.push(session)
    const held = session.prompt([{ type: 'text', text: 'hold' }], signal())
    const drain = session.cancel()
    await expect(
      session.prompt([{ type: 'text', text: 'too-soon' }], signal()),
    ).rejects.toMatchObject({ message: 'This agent is already answering.' })
    await drain
    await expect(held).resolves.toBe('cancelled')
    await expect(session.prompt([{ type: 'text', text: 'replacement' }], signal())).resolves.toBe(
      'end_turn',
    )
  })

  it('terminal-settles stdout EOF, refuses future requests and reaps its child without a caller timeout', async () => {
    const peer = new AcpPeer(input())
    disposables.push(peer)
    const pid = (await peer.request('fixture/pid', {})) as number
    expect(() => process.kill(pid, 0)).not.toThrow()
    const closed = peer.request('fixture/stdout-eof', {})
    const pending = peer.request('fixture/hang', {})
    await expect(closed).rejects.toMatchObject({ message: 'The agent connection closed.' })
    await expect(pending).rejects.toBeDefined()
    await expect(peer.request('fixture/pid', {})).rejects.toBeDefined()
    await peer.dispose()
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('settles a broken stdin pipe and rejects subsequent work', async () => {
    const peer = new AcpPeer(input())
    disposables.push(peer)
    const pid = (await peer.request('fixture/pid', {})) as number
    expect(() => process.kill(pid, 0)).not.toThrow()
    await peer.request('fixture/stdin-eof', {})
    await expect(
      peer.request('fixture/hang', { content: 'x'.repeat(1024 * 1024) }),
    ).rejects.toBeDefined()
    await expect(peer.request('fixture/pid', {})).rejects.toBeDefined()
    await peer.dispose()
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('disposes queued delivery to a non-reading child and settles every pending request', async () => {
    const ready = Promise.withResolvers<number>()
    const peer = new AcpPeer({
      ...input(['--no-read']),
      onNotification: (method, params) => {
        if (method === 'fixture/ready') ready.resolve((params as { pid: number }).pid)
      },
    })
    disposables.push(peer)
    const pid = await ready.promise
    expect(() => process.kill(pid, 0)).not.toThrow()
    const blocked = peer.request('fixture/hang', { content: 'x'.repeat(1024 * 1024) })
    const queued = peer.request('fixture/pid', {})
    const results = Promise.allSettled([blocked, queued])
    await Promise.resolve()
    await peer.dispose()
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it.each([
    { resume: 'absent', load: true, method: 'resume', supported: false },
    { resume: 'null', load: true, method: 'resume', supported: false },
    { resume: 'object', load: true, method: 'resume', supported: true },
    { resume: 'object', load: false, method: 'load', supported: false },
    { resume: 'absent', load: true, method: 'load', supported: true },
  ] as const)(
    'dispatches only advertised native $method for resume=$resume load=$load',
    async ({ resume, load, method, supported }) => {
      const operations: unknown[] = []
      const opening = AcpSession.open({
        ...input([`--resume=${resume}`, `--load=${load}`, '--audit-native']),
        signal: signal(),
        resume: { sessionId: 'saved-native-session', method },
        onNotification: (name, params) => {
          if (name === 'fixture/operation') operations.push(params)
        },
      })
      if (!supported) {
        await expect(opening).rejects.toMatchObject({
          message: 'This agent cannot resume the conversation.',
        })
        expect(operations).toEqual([])
        return
      }
      const session = await opening
      disposables.push(session)
      expect(operations).toEqual([{ method: `session/${method}` }])
    },
  )
})
