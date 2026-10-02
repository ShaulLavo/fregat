import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createError } from 'evlog'
import { spawnPty, type Pty } from '../src/index'

const executable = Bun.which('nvim')
if (!executable) {
  throw smokeError('The optional PTY smoke check requires nvim on PATH.')
}

// NOT-PORTABLE: Selects /work/tmp when /work exists without checking writability.
const base = existsSync('/work') ? '/work/tmp' : tmpdir()
await mkdir(base, { recursive: true })
const root = await mkdtemp(path.join(base, 'pty-nvim-'))
const readyPath = path.join(root, 'ready')
const sizePath = path.join(root, 'size')
const editedPath = path.join(root, 'edited.txt')
const chunks: Uint8Array[] = []
const decoder = new TextDecoder()
let pendingQueries = ''
let pty: Pty | undefined
let exitDeadline: ReturnType<typeof setTimeout> | undefined

const responses = [
  ['\x1b[c', '\x1b[?1;2c'],
  ['\x1b[5n', '\x1b[0n'],
  ['\x1b]11;?\x07', '\x1b]11;rgb:0000/0000/0000\x07'],
  ['\x1b[?u', '\x1b[?0u'],
] as const

function onData(bytes: Uint8Array) {
  chunks.push(bytes)
  pendingQueries += decoder.decode(bytes, { stream: true })
  for (const [query, response] of responses) {
    if (!pendingQueries.includes(query)) continue
    pty?.write(response)
    pendingQueries = pendingQueries.replaceAll(query, '')
  }
  pendingQueries = pendingQueries.slice(-256)
}

async function waitUntil(predicate: () => Promise<boolean>) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(20)
  }
  throw smokeError('Timed out waiting for Neovim PTY smoke check.')
}

function smokeError(message: string) {
  return createError({
    code: 'PTY_SMOKE_FAILED',
    message,
    status: 500,
    why: 'Neovim could not complete the expected terminal interaction.',
    fix: 'Check that nvim is on PATH and inspect its PTY output and process status.',
  })
}

function vimWrite(file: string, value: string) {
  return `call writefile(${value}, ${JSON.stringify(file)})`
}

try {
  pty = spawnPty({
    command: [
      executable,
      '-u',
      'NONE',
      '-i',
      'NONE',
      '-n',
      '--noplugin',
      '--cmd',
      `autocmd VimEnter * ${vimWrite(readyPath, '["ready"]')}`,
      '--cmd',
      `autocmd VimResized * ${vimWrite(sizePath, '[string(&columns), string(&lines)]')}`,
      editedPath,
    ],
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_STATE_HOME: path.join(root, 'state'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      TERM: 'xterm-256color',
    },
    cols: 80,
    rows: 24,
    onData,
  })
  await waitUntil(() => Bun.file(readyPath).exists())
  pty.resize(123, 41)
  await waitUntil(async () => {
    if (!existsSync(sizePath)) return false
    return (await readFile(sizePath, 'utf8')) === '123\n41\n'
  })
  pty.write('iBun native PTY saved this text.\x1b:wq\r')
  exitDeadline = setTimeout(() => pty?.kill('SIGKILL'), 10_000)
  const exit = await pty.exited
  clearTimeout(exitDeadline)
  assert.deepEqual(exit, { exitCode: 0, signal: null })
  const saved = await readFile(editedPath, 'utf8')
  assert.equal(saved, 'Bun native PTY saved this text.\n')
  const output = Buffer.concat(chunks).toString()
  assert.ok(output.includes('\x1b[?1049h'), 'Neovim must enter the alternate screen')
  assert.ok(output.includes('\x1b[?1049l'), 'Neovim must leave the alternate screen')
  console.log(
    JSON.stringify({ application: 'nvim', size: [123, 41], saved, exit, alternateScreen: true }),
  )
} finally {
  clearTimeout(exitDeadline)
  await pty?.[Symbol.asyncDispose]()
  await rm(root, { recursive: true, force: true })
}
