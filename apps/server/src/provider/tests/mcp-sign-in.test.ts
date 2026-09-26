import { describe, expect, it } from 'vitest'

import { McpSignInAttempts, matchingCallback, type McpSignInFlow } from '../mcp-sign-in'
import {
  authorizationUrlIn,
  startClaudeMcpSignIn,
  type ClaudeMcpLoginProcess,
} from '../adapters/utils/claude-mcp-sign-in'

const AUTHORIZATION =
  'https://auth.example.test/authorize?client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A56536%2Fcallback&state=s-1'

describe('matchingCallback', () => {
  it('accepts the redirect this attempt waits for, delivered to its own origin', () => {
    expect(
      matchingCallback(AUTHORIZATION, 'http://127.0.0.1:56536/callback?code=c&state=s-1').href,
    ).toBe('http://localhost:56536/callback?code=c&state=s-1')
  })

  it.each([
    ['another host', 'http://evil.example.test:56536/callback?code=c&state=s-1'],
    ['another port', 'http://localhost:9/callback?code=c&state=s-1'],
    ['another path', 'http://localhost:56536/admin?code=c&state=s-1'],
    ['another state', 'http://localhost:56536/callback?code=c&state=other'],
    ['https', 'https://localhost:56536/callback?code=c&state=s-1'],
    ['not an address', 'code=c'],
  ])('refuses %s', (_label, pasted) => {
    expect(() => matchingCallback(AUTHORIZATION, pasted)).toThrow(
      expect.objectContaining({ code: 'provider.MCP_SIGN_IN_ADDRESS_MISMATCH' }),
    )
  })
})

describe('McpSignInAttempts', () => {
  it('hands a matching address to the flow and reports how it ended', async () => {
    const outcome = Promise.withResolvers<void>()
    const finished: string[] = []
    const flow: McpSignInFlow = {
      authorizationUrl: AUTHORIZATION,
      cancel: () => outcome.reject(new Error('cancelled')),
      done: outcome.promise,
      finish: async (callback) => {
        finished.push(callback.href)
        outcome.resolve()
      },
    }
    const attempts = new McpSignInAttempts()
    const { attemptId } = attempts.start('linear', flow)

    expect(attempts.read(attemptId ?? '')).toMatchObject({ state: 'pending' })
    expect(
      await attempts.finish(attemptId ?? '', 'http://localhost:56536/callback?code=c&state=s-1'),
    ).toMatchObject({ name: 'linear', state: 'succeeded' })
    expect(finished).toEqual(['http://localhost:56536/callback?code=c&state=s-1'])
    expect(() => attempts.read('missing')).toThrow(
      expect.objectContaining({ code: 'provider.MCP_SIGN_IN_GONE' }),
    )
  })
})

/** `claude mcp login --no-browser` as its terminal shows it, faked. */
function fakeLogin(exitCode: number) {
  const written: string[] = []
  const exit = Promise.withResolvers<number>()
  let listener: (text: string) => void = () => {}
  const process: ClaudeMcpLoginProcess = {
    exited: exit.promise,
    kill: () => exit.resolve(143),
    onOutput: (next) => {
      listener = next
      queueMicrotask(() =>
        next(
          `Visit this URL to authorize:\n  \u001b]8;;${AUTHORIZATION}\u001b\\\u001b[94m${AUTHORIZATION}\u001b[39m\u001b]8;;\u001b\\\n`,
        ),
      )
    },
    write: (text) => {
      written.push(text)
      listener('Authenticated.\n')
      exit.resolve(exitCode)
    },
  }
  return { process, written }
}

describe('startClaudeMcpSignIn', () => {
  it('reads the printed address and types the pasted one into the CLI prompt', async () => {
    const login = fakeLogin(0)
    const args: string[][] = []
    const flow = await startClaudeMcpSignIn(
      (spawnArgs) => {
        args.push([...spawnArgs])
        return login.process
      },
      { folder: '/repo', name: 'linear' },
    )

    expect(flow.authorizationUrl).toBe(AUTHORIZATION)
    await flow.finish(new URL('http://localhost:56536/callback?code=c&state=s-1'))
    await flow.done
    expect(args).toEqual([['mcp', 'login', '--no-browser', 'linear']])
    expect(login.written).toEqual(['http://localhost:56536/callback?code=c&state=s-1\r'])
  })

  it('fails the attempt when the CLI exits without a token', async () => {
    const login = fakeLogin(1)
    const flow = await startClaudeMcpSignIn(() => login.process, { folder: '/repo', name: 'x' })
    await flow.finish(new URL('http://localhost:56536/callback?code=c&state=s-1'))

    await expect(flow.done).rejects.toMatchObject({ code: 'provider.MCP_SIGN_IN_FAILED' })
  })

  it('finds the address once terminal styling is stripped', () => {
    expect(authorizationUrlIn(`\u001b[1mgo:\u001b[0m ${AUTHORIZATION} \n`)).toBe(AUTHORIZATION)
    expect(authorizationUrlIn('Starting authentication…')).toBeNull()
  })
})
