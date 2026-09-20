import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { ProviderLoginAttempt, ProviderSignInMethod } from '@workspace/contracts'
import * as v from 'valibot'
import { createInternalError } from '../../../observability/structured-errors'
import { errorMessage as providerErrorMessage } from '@workspace/contracts'

/**
 * `claude auth login` opens a browser and blocks until the user finishes there,
 * so a forgotten attempt would keep a child process (and a browser tab) alive
 * for the lifetime of the server. Five minutes is generous for a human doing an
 * OAuth round trip and short enough that a walked-away user is cleaned up.
 */
const LOGIN_TIMEOUT_MS = 5 * 60_000

const SDK_ENTRY = '@anthropic-ai/claude-agent-sdk'

/** Lines of combined stdout/stderr kept on an attempt for the failure UI. */
const OUTPUT_TAIL_LINES = 20

const SIGN_IN_METHOD_FLAGS = {
  console: '--console',
  sso: '--sso',
  subscription: '--claudeai',
} satisfies Record<ProviderSignInMethod, string>

/**
 * Shape of `claude auth status --json`. Only `loggedIn` is load-bearing; the
 * other two are display detail and are tolerated missing so a CLI that adds or
 * renames fields degrades to "authenticated with no detail" instead of unknown.
 */
const authStatusPayloadSchema = v.object({
  loggedIn: v.boolean(),
  authMethod: v.optional(v.string()),
  apiProvider: v.optional(v.string()),
})

export type ClaudeAuthCommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type ClaudeAuthProcess = {
  exited: Promise<ClaudeAuthCommandResult>
  kill: () => void
}

/**
 * The single seam every test injects. Without it a test would spawn the real
 * `claude` binary — and for `auth login` that means actually opening a browser.
 */
export type ClaudeAuthSpawn = (args: readonly string[]) => ClaudeAuthProcess

export type ClaudeAuthState = {
  apiProvider: string | null
  authMethod: string | null
  status: 'authenticated' | 'unauthenticated' | 'unknown'
}

export type ClaudeLoginAttempt = Omit<ProviderLoginAttempt, 'providerInstanceId'>

export type ClaudeLoginInput = {
  email?: string
  method: ProviderSignInMethod
}

export type ClaudeAuthRunnerOptions = {
  /** Per-instance env; carries CLAUDE_CONFIG_DIR so each account reads its own credentials. */
  env?: NodeJS.ProcessEnv
  spawn?: ClaudeAuthSpawn
  timeoutMs?: number
}

type MutableLoginAttempt = {
  attemptId: string
  completedAt: string | null
  message?: string
  method: ProviderSignInMethod
  outputTail: string[]
  process: ClaudeAuthProcess
  startedAt: string
  state: ProviderLoginAttempt['state']
}

/**
 * Reads `claude auth status --json`. A non-zero exit, unparseable output, or a
 * spawn failure all resolve to `unknown` — this runs inside `snapshot()`, and a
 * throw there would take the whole provider list down over a CLI hiccup.
 */
export async function claudeAuthStatus(
  spawn: ClaudeAuthSpawn = defaultClaudeAuthSpawn,
): Promise<ClaudeAuthState> {
  const result = await runClaudeAuth(spawn, ['auth', 'status', '--json'])
  if (!result || result.exitCode !== 0) return unknownAuthState()

  const payload = v.safeParse(authStatusPayloadSchema, parseJsonObject(result.stdout))
  if (!payload.success) return unknownAuthState()

  return {
    apiProvider: payload.output.apiProvider ?? null,
    authMethod: payload.output.authMethod ?? null,
    status: payload.output.loggedIn ? 'authenticated' : 'unauthenticated',
  }
}

/**
 * Owns the one in-flight `claude auth login` child. Instance state, not module
 * state, so the adapter that owns the runner also owns its lifetime and tests
 * never inherit an attempt from a previous test.
 */
export class ClaudeAuthRunner {
  private readonly spawn: ClaudeAuthSpawn
  private readonly timeoutMs: number
  /**
   * Only the newest attempt is retained: the client polls the id it was handed,
   * and keeping a history would be an unbounded map of dead records.
   */
  private latest: MutableLoginAttempt | null = null

  constructor(options: ClaudeAuthRunnerOptions = {}) {
    const env = options.env ?? process.env
    this.spawn = options.spawn ?? ((args) => defaultClaudeAuthSpawn(args, env))
    this.timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS
  }

  status() {
    return claudeAuthStatus(this.spawn)
  }

  /**
   * Starts a login and returns immediately — the browser round trip outlives the
   * request. A second call while one is pending returns the running attempt so
   * the user never gets two browser windows for one sign-in.
   */
  startLogin(input: ClaudeLoginInput): ClaudeLoginAttempt {
    const pending = this.latest
    if (pending && pending.state === 'pending') return snapshotAttempt(pending)

    const attempt: MutableLoginAttempt = {
      attemptId: randomUUID(),
      completedAt: null,
      method: input.method,
      outputTail: [],
      process: this.spawn(claudeLoginArgs(input)),
      startedAt: new Date().toISOString(),
      state: 'pending',
    }
    this.latest = attempt
    this.watch(attempt)

    return snapshotAttempt(attempt)
  }

  attempt(attemptId: string): ClaudeLoginAttempt | null {
    const attempt = this.latest
    if (!attempt || attempt.attemptId !== attemptId) return null

    return snapshotAttempt(attempt)
  }

  cancel(attemptId: string): ClaudeLoginAttempt | null {
    const attempt = this.latest
    if (!attempt || attempt.attemptId !== attemptId) return null
    if (attempt.state !== 'pending') return snapshotAttempt(attempt)

    attempt.process.kill()
    finishAttempt(attempt, 'cancelled', 'Sign-in was cancelled.')

    return snapshotAttempt(attempt)
  }

  async signOut() {
    const pending = this.latest
    if (pending && pending.state === 'pending') this.cancel(pending.attemptId)

    const result = await runClaudeAuth(this.spawn, ['auth', 'logout'])
    if (!result) throw createInternalError('Could not run `claude auth logout`.')
    if (result.exitCode === 0) return

    throw createInternalError(
      `\`claude auth logout\` exited with code ${result.exitCode}.`,
      outputTail(result).join('\n'),
    )
  }

  private watch(attempt: MutableLoginAttempt) {
    const timer = setTimeout(() => expireAttempt(attempt), this.timeoutMs)
    const settled = attempt.process.exited.then(
      (result) => this.settle(attempt, result),
      (error) => finishAttempt(attempt, 'failed', providerErrorMessage(error)),
    )

    void settled.finally(() => clearTimeout(timer))
  }

  private async settle(attempt: MutableLoginAttempt, result: ClaudeAuthCommandResult) {
    if (attempt.state !== 'pending') return

    attempt.outputTail = outputTail(result)
    if (result.exitCode !== 0) {
      finishAttempt(attempt, 'failed', loginFailureMessage(result))
      return
    }

    // The CLI can exit 0 on an abandoned browser flow, so the account read is
    // what decides success — not the exit code.
    const status = await this.status()
    if (status.status === 'authenticated') {
      finishAttempt(attempt, 'succeeded')
      return
    }

    finishAttempt(attempt, 'failed', 'Sign-in finished but Claude Code still reports no account.')
  }
}

/** Exported for the method→flag mapping test; the runner is the only caller. */
export function claudeLoginArgs(input: ClaudeLoginInput) {
  const args = ['auth', 'login', SIGN_IN_METHOD_FLAGS[input.method]]
  if (!input.email) return args

  return [...args, '--email', input.email]
}

function expireAttempt(attempt: MutableLoginAttempt) {
  if (attempt.state !== 'pending') return

  attempt.process.kill()
  finishAttempt(attempt, 'failed', 'Sign-in timed out before an account was linked.')
}

function finishAttempt(
  attempt: MutableLoginAttempt,
  state: ProviderLoginAttempt['state'],
  message?: string,
) {
  if (attempt.state !== 'pending') return

  attempt.state = state
  attempt.completedAt = new Date().toISOString()
  if (message) attempt.message = message
}

function snapshotAttempt(attempt: MutableLoginAttempt): ClaudeLoginAttempt {
  return {
    attemptId: attempt.attemptId,
    completedAt: attempt.completedAt,
    method: attempt.method,
    outputTail: [...attempt.outputTail],
    startedAt: attempt.startedAt,
    state: attempt.state,
    ...(attempt.message ? { message: attempt.message } : {}),
  }
}

function loginFailureMessage(result: ClaudeAuthCommandResult) {
  const tail = outputTail(result).at(-1)
  if (tail) return tail

  return `\`claude auth login\` exited with code ${result.exitCode}.`
}

async function runClaudeAuth(spawn: ClaudeAuthSpawn, args: readonly string[]) {
  try {
    return await spawn(args).exited
  } catch {
    return null
  }
}

function outputTail(result: ClaudeAuthCommandResult) {
  return `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-OUTPUT_TAIL_LINES)
}

/**
 * The CLI can print a notice before the JSON body, so the object is sliced out
 * rather than parsed from the whole stream.
 */
function parseJsonObject(stdout: string): unknown {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(stdout.slice(start, end + 1))
  } catch {
    return null
  }
}

function unknownAuthState(): ClaudeAuthState {
  return { apiProvider: null, authMethod: null, status: 'unknown' }
}

function defaultClaudeAuthSpawn(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ClaudeAuthProcess {
  const child = Bun.spawn([claudeBinaryPath(), ...args], {
    env,
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  })

  const exited = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stderr, stdout }))

  return { exited, kill: () => child.kill() }
}

/**
 * Prefer the executable the agent SDK itself drives, so the account the app
 * signs in is the account the SDK reads back. Falls back to `claude` on PATH
 * when the platform package is absent (musl builds, global CLI installs).
 */
function claudeBinaryPath() {
  try {
    const fromSdk = createRequire(createRequire(import.meta.url).resolve(SDK_ENTRY))
    const manifest = fromSdk.resolve(
      `${SDK_ENTRY}-${process.platform}-${process.arch}/package.json`,
    )

    return path.join(path.dirname(manifest), process.platform === 'win32' ? 'claude.exe' : 'claude')
  } catch {
    return 'claude'
  }
}
