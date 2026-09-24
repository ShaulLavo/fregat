import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderAuthResult, ProviderLoginAttempt } from '@workspace/contracts'
import type { App } from '../../app'
import { closeTestApps, createTestApp } from '../../../test/server'
import { ClaudeProviderAdapter } from '../adapters/claude'
import { resolveFakeClaudeExecutable } from '../../../test/factories/claude-models'
import { MockProviderAdapter } from '../adapters/mock'
import {
  ClaudeAuthRunner,
  type ClaudeAuthCommandResult,
  type ClaudeAuthProcess,
  type ClaudeAuthSpawn,
} from '../adapters/utils/claude-auth'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { testSettingsOptions } from '../../settings/testing'

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** Account the fake SDK probe reports; only email/subscription decoration. */
const PROBE_ACCOUNT = { email: 'dev@example.com', subscriptionType: 'max' }

const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

/**
 * Stands in for the `claude` binary. `auth login` is deliberately a process that
 * never exits on its own — that is what the real CLI does while the browser is
 * open, and it is why a test must never reach the real binary.
 */
class FakeClaudeCli {
  loggedIn = false
  private finishLogin: ((result: ClaudeAuthCommandResult) => void) | null = null

  readonly spawn: ClaudeAuthSpawn = (args) => {
    if (args[1] === 'status') return settled(this.statusResult())
    if (args[1] === 'logout') {
      this.loggedIn = false
      return settled({ exitCode: 0, stderr: '', stdout: '' })
    }

    return {
      exited: new Promise<ClaudeAuthCommandResult>((resolve) => {
        this.finishLogin = resolve
      }),
      kill: () => {
        this.finishLogin?.({ exitCode: 143, stderr: '', stdout: '' })
        this.finishLogin = null
      },
    }
  }

  completeLogin() {
    const finish = this.finishLogin
    if (!finish) expect.unreachable('No login is in flight.')

    this.finishLogin = null
    this.loggedIn = true
    finish({ exitCode: 0, stderr: '', stdout: 'Login successful' })
  }

  private statusResult(): ClaudeAuthCommandResult {
    return {
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        apiProvider: 'firstParty',
        authMethod: this.loggedIn ? 'claudeai' : 'none',
        loggedIn: this.loggedIn,
      }),
    }
  }
}

function settled(result: ClaudeAuthCommandResult): ClaudeAuthProcess {
  return { exited: Promise.resolve(result), kill: () => {} }
}

/** The probe only ever calls `initializationResult()` and then aborts. */
function fakeProbeQuery(): Query {
  return {
    initializationResult: async () => ({ account: PROBE_ACCOUNT }),
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
  } as unknown as Query
}

async function testHarness() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-provider-auth-'))
  roots.push(root)

  const cli = new FakeClaudeCli()
  const claude = new ClaudeProviderAdapter({
    attachmentsDir: path.join(root, 'attachments'),
    auth: new ClaudeAuthRunner({ spawn: cli.spawn }),
    createQuery: fakeProbeQuery,
    resolveExecutable: resolveFakeClaudeExecutable,
  })
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    orchestration: {
      providerAdapterRegistry: new ProviderAdapterRegistry([claude, new MockProviderAdapter()]),
    },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })

  return { app, cli }
}

async function call(app: App, method: 'GET' | 'POST', route: string, body?: unknown) {
  const response = await app.handle(
    new Request(`http://local${route}`, {
      headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )

  return { body: await response.json(), status: response.status }
}

describe('provider auth routes', () => {
  it('reports a signed-out Claude account and the methods it can sign in with', async () => {
    const { app } = await testHarness()
    const result = await call(app, 'GET', '/providers/claude/auth')

    expect(result.status).toBe(200)
    expect(result.body as ProviderAuthResult).toMatchObject({
      auth: { status: 'unauthenticated' },
      providerInstanceId: 'claude',
      signInMethods: ['subscription', 'console', 'sso'],
      supportsSignIn: true,
    })
  })

  it('reports providers that cannot sign in from the app', async () => {
    const { app } = await testHarness()
    const result = await call(app, 'GET', '/providers/codex/auth')

    expect(result.status).toBe(200)
    expect(result.body as ProviderAuthResult).toMatchObject({
      providerInstanceId: 'codex',
      signInMethods: [],
      supportsSignIn: false,
    })
  })

  it('rejects sign-in for a provider that does not support it', async () => {
    const { app } = await testHarness()
    const result = await call(app, 'POST', '/providers/codex/auth/login', {
      method: 'subscription',
    })

    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ error: { code: 'provider.SIGN_IN_UNSUPPORTED' } })
  })

  it('404s an unknown provider instance', async () => {
    const { app } = await testHarness()
    const result = await call(app, 'GET', '/providers/nope/auth')

    expect(result.status).toBe(404)
    expect(result.body).toMatchObject({ error: { code: 'provider.INSTANCE_NOT_FOUND' } })
  })

  it('starts one login, polls it to success, and reports the account', async () => {
    const { app, cli } = await testHarness()
    const started = await call(app, 'POST', '/providers/claude/auth/login', {
      method: 'subscription',
    })
    const attempt = started.body as ProviderLoginAttempt

    expect(started.status).toBe(200)
    expect(attempt).toMatchObject({
      method: 'subscription',
      providerInstanceId: 'claude',
      state: 'pending',
    })

    const again = await call(app, 'POST', '/providers/claude/auth/login', { method: 'console' })
    expect((again.body as ProviderLoginAttempt).attemptId).toBe(attempt.attemptId)

    cli.completeLogin()
    const settledAttempt = await pollAttempt(app, attempt.attemptId)
    expect(settledAttempt.state).toBe('succeeded')

    const status = await call(app, 'GET', '/providers/claude/auth')
    expect((status.body as ProviderAuthResult).auth).toMatchObject({
      email: 'dev@example.com',
      status: 'authenticated',
      type: 'max',
    })
  })

  it('cancels a pending login', async () => {
    const { app } = await testHarness()
    const started = await call(app, 'POST', '/providers/claude/auth/login', { method: 'sso' })
    const { attemptId } = started.body as ProviderLoginAttempt

    const cancelled = await call(app, 'POST', `/providers/claude/auth/login/${attemptId}/cancel`)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body as ProviderLoginAttempt).toMatchObject({ state: 'cancelled' })
  })

  it('404s an attempt id it never handed out', async () => {
    const { app } = await testHarness()
    const result = await call(app, 'GET', '/providers/claude/auth/login/not-an-attempt')

    expect(result.status).toBe(404)
    expect(result.body).toMatchObject({ error: { code: 'provider.LOGIN_ATTEMPT_NOT_FOUND' } })
  })

  it('signs out and reports the signed-out account', async () => {
    const { app, cli } = await testHarness()
    cli.loggedIn = true

    const result = await call(app, 'POST', '/providers/claude/auth/logout')
    expect(result.status).toBe(200)
    expect(result.body as ProviderAuthResult).toMatchObject({
      auth: { status: 'unauthenticated' },
      supportsSignIn: true,
    })
  })
})

async function pollAttempt(app: App, attemptId: string) {
  for (let poll = 0; poll < 50; poll += 1) {
    const result = await call(app, 'GET', `/providers/claude/auth/login/${attemptId}`)
    const attempt = result.body as ProviderLoginAttempt
    if (attempt.state !== 'pending') return attempt

    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  expect.unreachable('Login attempt never settled.')
}
