import { parseTerminalClientMessage } from '@workspace/contracts'
import { log } from 'evlog'
import { ws, type WebSocketHandler, type WebSocketHandlerConnection } from 'msw'
import { DEMO_ROOT } from '../seed'
import type { DemoWorkspace } from '../state/workspace'

const PROMPT = '\u001b[36mgarden\u001b[0m \u001b[32mmain\u001b[0m ❯ '
const TEST_OUTPUT =
  'Simulated test run\r\n\u001b[32m✓\u001b[0m lavender is ready for autumn planting\r\n\u001b[32m✓\u001b[0m the garden has two beds\r\n\r\n\u001b[32m2 passed\u001b[0m · 0 failed\r\n'

type TerminalState = {
  line: string
  escape: boolean
  carriageReturn: boolean
  closed: boolean
}

type Write = (text: string) => void

export function demoTerminalHandler(apiOrigin: string, workspace: DemoWorkspace): WebSocketHandler {
  const url = new URL(`${apiOrigin.replace(/\/$/, '')}/terminal`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return ws.link(url.href).addEventListener('connection', (connection) => {
    connectTerminal(connection, workspace)
  })
}

function connectTerminal({ client }: WebSocketHandlerConnection, workspace: DemoWorkspace) {
  const state: TerminalState = { line: '', escape: false, carriageReturn: false, closed: false }
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const write: Write = (text) => {
    if (!state.closed) client.send(encoder.encode(text))
  }
  let pending = Promise.resolve()
  async function receive(data: unknown) {
    const message = parseTerminalClientMessage(
      data instanceof Blob ? await data.arrayBuffer() : data,
    )
    if (message?.type === 'dispose') {
      state.closed = true
      client.close(1000)
      return
    }
    if (message?.type !== 'input' || state.closed) return
    await typeInput(decoder.decode(message.data, { stream: true }), state, workspace, write)
  }
  client.send(JSON.stringify({ type: 'ready', shell: 'demo', cwd: DEMO_ROOT }))
  write(
    `\u001b[2mBrowser demo · type help for simulated commands\u001b[0m\r\n\r\n${PROMPT}bun test\r\n${TEST_OUTPUT}\r\n${PROMPT}`,
  )
  client.addEventListener('close', () => {
    state.closed = true
  })
  client.addEventListener('message', (event) => {
    pending = pending
      .then(() => receive(event.data))
      .catch((error: unknown) => {
        log.error({ area: 'demo', action: 'terminal.command', outcome: 'error', error })
        const message =
          error instanceof Error ? error.message : 'The simulated command could not finish.'
        write(`\r\n${message}\r\n${PROMPT}`)
      })
  })
}

async function typeInput(
  input: string,
  state: TerminalState,
  workspace: DemoWorkspace,
  write: Write,
) {
  for (const character of input) {
    if (state.closed) return
    await typeCharacter(character, state, workspace, write)
  }
}

async function typeCharacter(
  character: string,
  state: TerminalState,
  workspace: DemoWorkspace,
  write: Write,
) {
  if (state.escape) {
    if (/[A-Za-z~]/.test(character)) state.escape = false
    return
  }
  if (character === '\u001b') {
    state.escape = true
    return
  }
  if (character === '\n' && state.carriageReturn) {
    state.carriageReturn = false
    return
  }
  state.carriageReturn = character === '\r'
  if (character === '\u0003') {
    state.line = ''
    write(`^C\r\n${PROMPT}`)
    return
  }
  if (character === '\u007f' || character === '\b') {
    if (state.line) {
      state.line = Array.from(state.line).slice(0, -1).join('')
      write('\b \b')
    }
    return
  }
  if (character === '\r' || character === '\n') {
    const line = state.line
    state.line = ''
    write('\r\n')
    const output = await execute(line, workspace)
    if (output) write(output.replace(/\r?\n/g, '\r\n'))
    write(PROMPT)
    return
  }
  if (character < ' ') return
  state.line += character
  write(character)
}

async function execute(line: string, workspace: DemoWorkspace): Promise<string> {
  const [command, ...args] = words(line)
  if (!command) return ''
  switch (command) {
    case 'help':
      return 'This shell runs in your browser. Commands are simulated; files and git changes stay in this demo.\n\nhelp · pwd · ls [path] · cat <file> · echo <text> [> file]\ntouch <file> · clear · bun test · git status · git add <file|.> · git commit -m "message"\n'
    case 'pwd':
      return `${DEMO_ROOT}\n`
    case 'ls':
      return `${workspace
        .tree(args.find((arg) => !arg.startsWith('-')) ?? '.')
        .entries.map((entry) => entry.name + (entry.type === 'directory' ? '/' : ''))
        .join('  ')}\n`
    case 'cat':
      return (
        args
          .map((path) => workspace.readFile(path)?.content ?? `cat: ${path}: no such file\n`)
          .join('') + '\n'
      )
    case 'echo':
      return echo(args, workspace)
    case 'touch':
      return touch(args, workspace)
    case 'clear':
      return '\u001b[2J\u001b[H'
    case 'bun':
      return args[0] === 'test'
        ? TEST_OUTPUT
        : 'Only bun test is available in this simulated shell.\n'
    case 'git':
      return git(args, workspace)
    default:
      return `${command}: not available in this browser demo. Type help.\n`
  }
}

async function echo(args: string[], workspace: DemoWorkspace) {
  const redirect = args.findIndex((word) => word === '>' || word === '>>')
  if (redirect < 0) return `${args.join(' ')}\n`
  const target = args[redirect + 1]
  if (!target) return 'echo: provide a file after the redirect\n'
  const path = workspace.path(target)
  const previous = args[redirect] === '>>' ? (workspace.readFile(path)?.content ?? '') : ''
  await workspace.writeFile(path, `${previous}${args.slice(0, redirect).join(' ')}\n`)
  return ''
}

async function touch(paths: string[], workspace: DemoWorkspace) {
  if (!paths.length) return 'touch: provide a file name\n'
  for (const path of paths) {
    if (!workspace.readFile(path)) await workspace.writeFile(path, '')
  }
  return ''
}

function git(args: string[], workspace: DemoWorkspace) {
  const status = workspace.gitStatus()
  if (args[0] === 'status') {
    const files = status.files
      .map((file) => `  ${file.index !== 'unmodified' ? 'staged' : file.status}: ${file.path}`)
      .join('\n')
    return `On branch ${status.repository?.branch ?? 'main'}\n${files || 'nothing to commit, working tree clean'}\n`
  }
  if (args[0] === 'add') {
    const paths = args.slice(1)
    if (!paths.length) return 'git add: provide a file or .\n'
    workspace.stage(paths.includes('.') ? status.files.map((file) => file.path) : paths, true)
    return ''
  }
  if (args[0] === 'commit') {
    const messageIndex = args.indexOf('-m')
    const message = messageIndex >= 0 ? args[messageIndex + 1] : undefined
    if (!message) return 'git commit: use -m "your message"\n'
    return `${workspace.commit(message).output}\n`
  }
  return 'Simulated git supports status, add and commit. Type help.\n'
}

function words(line: string) {
  return Array.from(
    line.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g),
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  )
}
