import { spawn, type ChildProcessByStdio } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fixtureSource } from './fixture-source'
import {
  liveNativeProcesses,
  reapNativeProcesses,
  type NativeProcessEntry,
} from './native-processes'

const FIXTURES = path.join(import.meta.dirname, 'fixtures')
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'fregat-native-fixtures-')))
// The absolute-path cases aim here, so a regression writes nowhere but this run's scratch.
const outside = mkdtempSync(path.join(scratch, 'outside-'))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

type Message = Record<string, any>

/** One fixture process over stdio, the way the SDK or the Codex client drives it. */
class FixtureProcess {
  readonly child: ChildProcessByStdio<Writable, Readable, null>
  readonly exited: Promise<number | null>
  private readonly seen: Message[] = []
  private cursor = 0
  private wake: (() => void) | null = null

  constructor(binary: string, args: readonly string[], options: { cwd: string; env: object }) {
    this.child = spawn(binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    this.exited = new Promise((resolve) => this.child.on('exit', (code) => resolve(code)))
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      this.seen.push(JSON.parse(line))
      this.wake?.()
    })
  }

  send(message: Message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** The first message after the last one returned that matches. */
  async next(match: (message: Message) => boolean) {
    const deadline = Date.now() + 10_000
    for (;;) {
      const index = this.seen.findIndex((message, at) => at >= this.cursor && match(message))
      if (index >= 0) {
        this.cursor = index + 1
        return this.seen[index]!
      }
      if (Date.now() > deadline) throw new Error('The fixture never sent the expected message')
      await new Promise<void>((resolve) => {
        this.wake = resolve
        setTimeout(resolve, 100)
      })
    }
  }
}

async function fixtureRoot(name: string, fixture: string, binary: string) {
  const root = mkdtempSync(path.join(scratch, `${name}-`))
  const file = path.join(root, binary)
  writeFileSync(file, await fixtureSource(path.join(FIXTURES, fixture)))
  chmodSync(file, 0o700)
  const repo = path.join(root, 'repo')
  mkdirSync(repo)
  mkdirSync(path.join(root, 'config'))
  return { root, file, repo }
}

async function startClaude(name: string, permissionMode: string, prepare?: (repo: string) => void) {
  const { root, file, repo } = await fixtureRoot(name, 'native-claude.ts', 'claude')
  prepare?.(repo)
  const args = [
    '--output-format',
    'stream-json',
    '--verbose',
    '--input-format',
    'stream-json',
    '--permission-mode',
    permissionMode,
    `--session-id=${crypto.randomUUID()}`,
  ]
  const fixture = new FixtureProcess(file, args, {
    cwd: repo,
    env: { CLAUDE_CONFIG_DIR: path.join(root, 'config') },
  })
  fixture.send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } })
  return { fixture, repo, root }
}

function prompt(fixture: FixtureProcess, text: string) {
  fixture.send({
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
    uuid: crypto.randomUUID(),
  })
}

function nativeEntries(root: string): NativeProcessEntry[] {
  return readFileSync(path.join(root, 'native.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function settles(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return check()
}

describe("the Claude fixture's Bash tool", () => {
  let claude: Awaited<ReturnType<typeof startClaude>>

  beforeAll(async () => {
    claude = await startClaude('bash', 'bypassPermissions', (repo) =>
      symlinkSync(outside, path.join(repo, 'link')),
    )
    await claude.fixture.next((message) => message.type === 'control_response')
  })
  afterAll(() => claude.fixture.child.kill())

  async function run(command: string) {
    prompt(claude.fixture, `Use the Bash tool to run \`${command}\`. Then reply with exactly DONE.`)
    const result = await claude.fixture.next(
      (message) => message.type === 'user' && message.message.content[0]?.type === 'tool_result',
    )
    await claude.fixture.next((message) => message.type === 'result')
    return result.message.content[0] as { is_error: boolean; content: string }
  }

  it.each([
    'touch ok second',
    `touch ok ${outside}/escaped ../escaped-up`,
    `touch ${outside}/escaped`,
    'touch ../escaped-up',
    'touch sub/../../escaped-up',
    'touch -a',
    'touch --reference=/etc/hostname ok',
    'touch link/escaped',
    'ls /',
    'ls ..',
    'ls -la',
    'ls ok second',
    'ls link',
    'sleep x',
    'sleep 1 2',
    'sleep -1',
    'sleep --help',
    'rm ok',
  ])('refuses `%s`', async (command) => {
    const outcome = await run(command)
    expect(outcome.is_error).toBe(true)
    expect(readdirSync(outside)).toEqual([])
    expect(existsSync(path.join(claude.root, 'escaped-up'))).toBe(false)
  })

  it.each(['touch made.txt', 'ls', 'sleep 0'])('runs `%s`', async (command) => {
    expect((await run(command)).is_error).toBe(false)
  })

  it('touches the one file inside the checkout', () => {
    expect(readdirSync(claude.repo).sort()).toEqual(['link', 'made.txt'])
  })
})

const MCP_SERVER = `
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const result = message.method === 'tools/list' ? { tools: [] } : { serverInfo: { name: 'fixture', version: '1' } }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
})
`

describe('a fixture whose stdin closes mid-approval', () => {
  it('Claude exits and takes its MCP server and background task with it', async () => {
    const { fixture, repo, root } = await startClaude('close', 'default', (checkout) => {
      writeFileSync(path.join(checkout, 'mcp.cjs'), MCP_SERVER)
      writeFileSync(
        path.join(checkout, '.mcp.json'),
        JSON.stringify({ mcpServers: { fixture: { command: 'node', args: ['mcp.cjs'] } } }),
      )
      mkdirSync(path.join(checkout, '.claude'))
      writeFileSync(
        path.join(checkout, '.claude', 'settings.json'),
        JSON.stringify({
          enableAllProjectMcpServers: true,
          permissions: { allow: ['Bash(sleep 600)'] },
        }),
      )
    })
    prompt(
      fixture,
      'Use the Bash tool with run_in_background set to true to run `sleep 600`. Then reply with exactly STARTED.',
    )
    await fixture.next((message) => message.type === 'result')
    prompt(fixture, 'Use the Bash tool to run `touch marker.txt`. Then reply with exactly DONE.')
    await fixture.next(
      (message) => message.type === 'control_request' && message.request.subtype === 'can_use_tool',
    )
    const children = nativeEntries(root).filter((entry) => entry.event === 'child')
    expect(children.map((entry) => entry.kind).sort()).toEqual(['mcp', 'task'])
    expect(liveNativeProcesses(root, children)).toHaveLength(2)

    fixture.child.stdin.end()
    expect(await fixture.exited).toBe(0)
    expect(await settles(() => liveNativeProcesses(root, nativeEntries(root)).length === 0)).toBe(
      true,
    )
    expect(existsSync(path.join(repo, 'marker.txt'))).toBe(false)
  }, 30_000)

  async function startCodex(name: string, hold: boolean) {
    const { root, file, repo } = await fixtureRoot(name, 'native-conversation.ts', 'codex.mjs')
    if (hold) writeFileSync(path.join(root, 'hold'), '')
    const fixture = new FixtureProcess(file, [], { cwd: repo, env: { CODEX_HOME: root } })
    fixture.send({ id: 1, method: 'initialize', params: {} })
    fixture.send({
      id: 2,
      method: 'thread/start',
      params: { cwd: repo, approvalPolicy: 'on-request' },
    })
    return { fixture, repo, root }
  }

  async function turn(fixture: FixtureProcess, text: string) {
    const started = await fixture.next((message) => message.id === 2)
    fixture.send({
      id: 3,
      method: 'turn/start',
      params: { threadId: started.result.thread.id, input: [{ type: 'text', text }] },
    })
  }

  it('Codex exits with a command approval pending', async () => {
    const { fixture, repo } = await startCodex('codex-approval', false)
    await turn(fixture, 'Run exactly `touch marker.txt` and reply with exactly DONE.')
    await fixture.next((message) => message.method === 'item/commandExecution/requestApproval')
    fixture.child.stdin.end()
    expect(await fixture.exited).toBe(0)
    expect(existsSync(path.join(repo, 'marker.txt'))).toBe(false)
  }, 30_000)

  it('Codex exits with a turn held running', async () => {
    const { fixture } = await startCodex('codex-hold', true)
    await turn(fixture, 'Reply with exactly HELD.')
    await fixture.next((message) => message.method === 'turn/started')
    fixture.child.stdin.end()
    expect(await fixture.exited).toBe(0)
  }, 30_000)
})

describe('the harness reaping native fixture processes', () => {
  it('kills a recorded child still running in its checkout, and nothing it cannot identify', async () => {
    const checkout = mkdtempSync(path.join(scratch, 'reap-'))
    const survivor = spawn('sleep', ['30'], { cwd: checkout, stdio: 'ignore' })
    const survivorSignal = new Promise((resolve) =>
      survivor.on('exit', (_code, signal) => resolve(signal)),
    )
    const stranger = spawn('sleep', ['30'], { cwd: scratch, stdio: 'ignore' })
    const entries: NativeProcessEntry[] = [
      { event: 'child', childPid: survivor.pid, cwd: checkout },
      // Recorded in another checkout: a pid that now belongs to someone else.
      { event: 'child', childPid: stranger.pid, cwd: checkout },
    ]
    try {
      const live = liveNativeProcesses(scratch, entries)
      expect(live).toEqual([{ pid: survivor.pid, kind: 'child' }])
      reapNativeProcesses(live)
      expect(await survivorSignal).toBe('SIGKILL')
      expect(stranger.exitCode).toBeNull()
      expect(stranger.signalCode).toBeNull()
    } finally {
      survivor.kill('SIGKILL')
      stranger.kill('SIGKILL')
    }
  })
})
