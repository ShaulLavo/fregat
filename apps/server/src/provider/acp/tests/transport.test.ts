import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpPeer } from '../peer'
import { AcpSession } from '../session'

const executable = path.resolve(
  import.meta.dirname,
  '../../../../../../scripts/agent/fixtures/fake-acp.mjs',
)
const disposables: { dispose: () => Promise<void> }[] = []
const input = () => ({ executable, args: [], cwd: import.meta.dirname, env: process.env })
const signal = () => AbortSignal.timeout(5000)

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()))
})

describe('ACP fixture transport gate', () => {
  it('correlates concurrent RPCs and refuses provider errors without exposing their messages', async () => {
    const peer = new AcpPeer(input())
    disposables.push(peer)
    const results = await Promise.all([
      peer.request('initialize', {}, signal()),
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
    await expect(peer.request('initialize', {}, signal())).resolves.toMatchObject({
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
