import { createMetadataDatabase } from '../src/db/client'
import { migratePlatformDatabase } from '../src/db/migrations'
import { processExists } from './process-exists'
import { shellQuote } from '../src/utils/shell'
import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { platform, release, tmpdir } from 'node:os'
import path from 'node:path'
import { createError } from 'evlog'
import { parseTerminalServerMessage, terminalLeaseIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { createAuthConfig } from '../src/auth'
import { createWorkspacePaths } from '../src/fs/path'
import { TerminalService } from '../src/terminal/service'

const ORIGIN = 'http://localhost:5173'
const WORKTREE_ID = '00000000-0000-4000-8000-000000000001'
const DEADLINE_MS = 10_000

class TerminalCapture {
  readonly chunks: Uint8Array[] = []
  readonly decoder = new TextDecoder()
  pendingQueries = ''
  exitCode: number | null | undefined
  error: string | null = null
  respond: ((value: string) => void) | null = null

  send(value: string | Uint8Array) {
    const message = parseTerminalServerMessage(value)
    if (!message) throw smokeError('The service emitted an invalid terminal frame.')
    if (message.type === 'error') this.error = message.message
    if (message.type === 'exit') this.exitCode = message.exitCode
    if (message.type !== 'output') return
    this.chunks.push(Buffer.from(message.data))
    if (!this.respond) return
    this.pendingQueries += this.decoder.decode(message.data, { stream: true })
    this.answerQueries()
  }

  get output() {
    return Buffer.concat(this.chunks)
  }

  private answerQueries() {
    const responses = [
      ['\x1b[c', '\x1b[?1;2c'],
      ['\x1b[5n', '\x1b[0n'],
      ['\x1b]11;?\x07', '\x1b]11;rgb:0000/0000/0000\x07'],
      ['\x1b[?u', '\x1b[?0u'],
    ] as const
    for (const [query, response] of responses) {
      if (!this.pendingQueries.includes(query)) continue
      this.respond?.(response)
      this.pendingQueries = this.pendingQueries.replaceAll(query, '')
    }
    this.pendingQueries = this.pendingQueries.slice(-256)
  }
}

function smokeError(message: string) {
  return createError({
    code: 'TERMINAL_SERVICE_SMOKE_FAILED',
    message,
    status: 500,
    why: 'The production terminal service did not complete its expected PTY interaction.',
    fix: 'Inspect the shell output, terminal lifecycle, and native runtime on this machine.',
  })
}

async function waitUntil(label: string, predicate: () => boolean | Promise<boolean>) {
  const deadline = performance.now() + DEADLINE_MS
  while (performance.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(5)
  }
  throw smokeError(`Timed out waiting for ${label}.`)
}

function socketFor(id: string, capture: TerminalCapture) {
  return {
    raw: {},
    data: {
      headers: { origin: ORIGIN },
      query: { worktreeId: WORKTREE_ID, terminalId: id, cols: 80, rows: 24 },
    },
    send: (value: string | Uint8Array) => capture.send(value),
    close() {},
  }
}

async function openShell(service: TerminalService, root: string, id: string) {
  const routes = service.routes(createAuthConfig({ allowedOrigins: [ORIGIN] }))
  const capture = new TerminalCapture()
  const socket = socketFor(id, capture)
  await routes.open(socket)
  const input = (value: string | Uint8Array) =>
    routes.message(socket, typeof value === 'string' ? Buffer.from(value) : value)
  const pidFile = path.join(root, `${id}.pid`)
  input(`stty -echo; printf '%s %s\\n' "$$" "$PPID" > ${shellQuote(pidFile)}\n`)
  await waitUntil('shell PID', () => Bun.file(pidFile).exists())
  const [pid, parentPid] = (await readFile(pidFile, 'utf8')).trim().split(' ').map(Number)
  assert.ok(Number.isInteger(pid) && pid > 1)
  assert.equal(parentPid, process.pid, 'The shell must be a direct child of the Bun service.')
  return { id, routes, socket, capture, input, pid }
}

type Shell = Awaited<ReturnType<typeof openShell>>

async function verifyControlKeys(shell: Shell, root: string) {
  const sizeFile = path.join(root, 'shell-size')
  shell.routes.message(shell.socket, JSON.stringify({ type: 'resize', cols: 123, rows: 41 }))
  shell.input(`stty size > ${shellQuote(sizeFile)}; printf 'SIZE_READY\\n'\n`)
  await waitUntil('resized shell', () => shell.capture.output.includes('SIZE_READY\r\n'))
  assert.equal((await readFile(sizeFile, 'utf8')).trim(), '41 123')
  shell.input("printf 'SLEEP_READY\\n'; sleep 30\n")
  await waitUntil('foreground sleep', () => shell.capture.output.includes('SLEEP_READY\r\n'))
  shell.input('\x03')
  shell.input("printf 'INTERRUPT_OK\\n'\n")
  await waitUntil('Ctrl-C shell recovery', () => shell.capture.output.includes('INTERRUPT_OK\r\n'))
}

async function verifyBinaryAndReplay(shell: Shell) {
  shell.input("stty raw -echo; printf 'RAW_READY\\n'; exec cat\n")
  await waitUntil('raw cat', () => shell.capture.output.includes('RAW_READY\n'))
  const offset = shell.capture.output.byteLength
  const bytes = Uint8Array.from({ length: 2 * 1024 * 1024 }, (_, index) => index % 256)
  shell.input(bytes)
  await waitUntil('binary echo', () => shell.capture.output.byteLength >= offset + bytes.length)
  assert.deepEqual(shell.capture.output.subarray(offset), Buffer.from(bytes))
  const marker = Buffer.from('DETACHED_OUTPUT_🙂\n')
  shell.input(marker)
  shell.routes.close(shell.socket)
  await Bun.sleep(25)
  const replay = new TerminalCapture()
  const replacement = socketFor(shell.id, replay)
  await shell.routes.open(replacement)
  await waitUntil('detached output replay', () => replay.output.includes(marker))
  assert.deepEqual(replay.output, Buffer.concat([Buffer.from(bytes), marker]).subarray(-256 * 1024))
  assert.equal(replay.error, null)
  return { binaryEchoBytes: bytes.length, replayBytes: replay.output.length }
}

async function verifyNeovim(shell: Shell, root: string) {
  const executable = Bun.which('nvim')
  if (!executable) throw smokeError('The service smoke check requires nvim on PATH.')
  const readyFile = path.join(root, 'nvim-ready')
  const sizeFile = path.join(root, 'nvim-size')
  const editedFile = path.join(root, 'edited.txt')
  const args = [
    executable,
    '-u',
    'NONE',
    '-i',
    'NONE',
    '-n',
    '--noplugin',
    '--cmd',
    `autocmd VimEnter * call writefile(["ready"], ${JSON.stringify(readyFile)})`,
    '--cmd',
    `autocmd VimResized * call writefile([string(&columns), string(&lines)], ${JSON.stringify(sizeFile)})`,
    editedFile,
  ]
  shell.capture.respond = shell.input
  shell.input(`exec ${args.map(shellQuote).join(' ')}\n`)
  await waitUntil('Neovim startup', () => Bun.file(readyFile).exists())
  shell.routes.message(shell.socket, JSON.stringify({ type: 'resize', cols: 117, rows: 37 }))
  await waitUntil(
    'Neovim resize',
    async () => existsSync(sizeFile) && (await readFile(sizeFile, 'utf8')) === '117\n37\n',
  )
  shell.input('iPlatform uses its native Bun PTY.\x1b:wq\r')
  await waitUntil('Neovim exit', () => shell.capture.exitCode !== undefined)
  assert.equal(shell.capture.exitCode, 0)
  assert.equal(await readFile(editedFile, 'utf8'), 'Platform uses its native Bun PTY.\n')
  assert.ok(shell.capture.output.includes('\x1b[?1049h'))
  assert.ok(shell.capture.output.includes('\x1b[?1049l'))
  return { size: [117, 37], saved: true, exitCode: shell.capture.exitCode, alternateScreen: true }
}

async function main() {
  const base = existsSync('/work') ? '/work/tmp' : tmpdir()
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, 'terminal-service-smoke-'))
  const historyDatabase = createMetadataDatabase({
    databasePath: path.join(root, 'history.sqlite'),
  })
  migratePlatformDatabase(historyDatabase.db)
  let endedLeases = 0
  const service = new TerminalService({
    database: historyDatabase.db,
    paths: createWorkspacePaths(root),
    resolveWorktree: async () => root,
    env: { HOME: root, PATH: process.env.PATH, SHELL: '/bin/sh', TERM: 'xterm-256color' },
    lifecycle: {
      begin: async () => ({
        terminalLeaseId: v.parse(terminalLeaseIdSchema, crypto.randomUUID()),
        runtimeEpoch: 'smoke-test',
        activate: async () => {},
        terminate: async () => {},
        markUnknown: async () => {},
        end: async () => {
          endedLeases += 1
        },
      }),
    },
  })
  try {
    const shells = await Promise.all(
      ['binary', 'editor', 'eof'].map((id) => openShell(service, root, id)),
    )
    const [binary, editor, eof] = shells
    assert.equal(new Set(shells.map((shell) => shell.pid)).size, 3)
    await verifyControlKeys(editor, root)
    const bytes = await verifyBinaryAndReplay(binary)
    eof.input('\x04')
    await waitUntil('Ctrl-D shell exit', () => eof.capture.exitCode !== undefined)
    assert.equal(eof.capture.exitCode, 0)
    const nvim = await verifyNeovim(editor, root)
    await service.dispose()
    for (const shell of shells) assert.equal(processExists(shell.pid), false)
    assert.equal(endedLeases, 3)
    console.log(
      JSON.stringify({
        platform: platform(),
        release: release(),
        bun: Bun.version,
        directShells: 3,
        controls: ['Ctrl-C', 'Ctrl-D'],
        ...bytes,
        nvim,
        disposed: true,
      }),
    )
  } finally {
    await service.dispose()
    historyDatabase.close()
    await rm(root, { recursive: true, force: true })
  }
}

await main()
