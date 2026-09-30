import { spawn } from '@lydell/node-pty'

type BridgeMessage =
  | { type: 'output'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; exitCode: number | null; signal: number | null }

const MAX_COLS = 1_000
const MAX_ROWS = 500
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_COMMAND_CHARS = Math.ceil((MAX_INPUT_BYTES * 4) / 3) + 256

let terminal: ReturnType<typeof spawn> | undefined
let commandBuffer = ''
let shuttingDown = false
let terminalExited = false

start()

function start() {
  try {
    const config = parseConfig(process.argv[2])
    terminal = spawn(resolveShell(), resolveShellArguments(), {
      cols: config.cols,
      cwd: config.cwd,
      encoding: null,
      env: terminalEnvironment(),
      name: 'xterm-256color',
      rows: config.rows,
    })
  } catch (cause) {
    sendAndExit({ type: 'error', message: errorMessage(cause) }, 1)
    return
  }

  terminal.onData(handleTerminalData)
  terminal.onExit(handleTerminalExit)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', handleCommandChunk)
  process.stdin.on('end', shutdown)
  process.stdin.on('error', shutdown)
  process.stdout.on('drain', resumeTerminal)
  process.stdout.on('error', exitAfterBrokenPipe)
  process.once('SIGINT', handleInterrupt)
  process.once('SIGTERM', handleTermination)
  process.once('exit', killTerminal)
}

function parseConfig(encoded: string | undefined) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new TypeError('Missing PTY bridge configuration')
  }

  let value: unknown
  try {
    value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new TypeError('Invalid PTY bridge configuration')
  }
  if (!isRecord(value) || Object.keys(value).length !== 3) {
    throw new TypeError('Invalid PTY bridge configuration shape')
  }
  validateDimension(value.cols, MAX_COLS, 'cols')
  validateDimension(value.rows, MAX_ROWS, 'rows')
  if (typeof value.cwd !== 'string' || value.cwd.length === 0) {
    throw new TypeError('Invalid PTY working directory')
  }
  return { cols: value.cols, rows: value.rows, cwd: value.cwd }
}

function resolveShell() {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/sh'
}

function resolveShellArguments() {
  if (process.platform === 'win32') return []
  return ['-l']
}

function terminalEnvironment() {
  const environment: Record<string, string> = { COLORTERM: 'truecolor', TERM: 'xterm-256color' }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value
  }
  return environment
}

function handleTerminalData(data: unknown) {
  if (!(data instanceof Uint8Array)) {
    failBridge(new TypeError('node-pty returned decoded text despite encoding: null'))
    return
  }

  const line = encodeLine({ type: 'output', data: Buffer.from(data).toString('base64') })
  if (process.stdout.write(line)) return
  terminal?.pause()
}

function handleTerminalExit(event: { exitCode: number; signal?: number }) {
  if (terminalExited) return
  terminalExited = true
  const exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null
  const signal =
    typeof event.signal === 'number' && Number.isInteger(event.signal) ? event.signal : null
  sendAndExit({ type: 'exit', exitCode, signal }, 0)
}

function handleCommandChunk(chunk: string) {
  commandBuffer += chunk
  if (commandBuffer.length > MAX_COMMAND_CHARS) {
    failBridge(new RangeError('PTY bridge command exceeds the size limit'))
    return
  }

  let newline = commandBuffer.indexOf('\n')
  while (newline >= 0) {
    const line = commandBuffer.slice(0, newline)
    commandBuffer = commandBuffer.slice(newline + 1)
    handleCommandLine(line)
    if (shuttingDown) return
    newline = commandBuffer.indexOf('\n')
  }
}

function handleCommandLine(line: string) {
  if (line.length === 0) return

  let command: unknown
  try {
    command = JSON.parse(line)
  } catch {
    failBridge(new TypeError('Invalid PTY bridge command JSON'))
    return
  }
  dispatchCommand(command)
}

function dispatchCommand(command: unknown) {
  if (!isRecord(command) || typeof command.type !== 'string') {
    failBridge(new TypeError('Invalid PTY bridge command'))
    return
  }
  if (command.type === 'input') {
    writeInput(command)
    return
  }
  if (command.type === 'resize') {
    resizeTerminal(command)
    return
  }
  if (command.type === 'close' && Object.keys(command).length === 1) {
    shutdown()
    return
  }
  failBridge(new TypeError('Unknown PTY bridge command'))
}

function writeInput(command: Record<string, unknown>) {
  if (Object.keys(command).length !== 2 || typeof command.data !== 'string') {
    failBridge(new TypeError('Invalid PTY input command'))
    return
  }

  const bytes = decodeBase64(command.data)
  if (bytes === undefined) return
  try {
    terminal?.write(bytes)
  } catch (cause) {
    failBridge(cause)
  }
}

function decodeBase64(encoded: string) {
  if (
    encoded.length > MAX_COMMAND_CHARS ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    failBridge(new TypeError('Invalid base64 PTY input'))
    return undefined
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength <= MAX_INPUT_BYTES && bytes.toString('base64') === encoded) return bytes
  failBridge(new RangeError('PTY input exceeds the size limit'))
  return undefined
}

function resizeTerminal(command: Record<string, unknown>) {
  if (Object.keys(command).length !== 3) {
    failBridge(new TypeError('Invalid PTY resize command'))
    return
  }
  try {
    validateDimension(command.cols, MAX_COLS, 'cols')
    validateDimension(command.rows, MAX_ROWS, 'rows')
    terminal?.resize(command.cols, command.rows)
  } catch (cause) {
    failBridge(cause)
  }
}

function validateDimension(value: unknown, maximum: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}`)
  }
}

function resumeTerminal() {
  if (shuttingDown) return
  terminal?.resume()
}

function failBridge(cause: unknown) {
  if (shuttingDown) return
  send({ type: 'error', message: errorMessage(cause) })
  shutdown()
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  killTerminal()
}

function killTerminal() {
  try {
    terminal?.kill()
  } catch {
    // The PTY may already have closed independently.
  }
}

function handleInterrupt() {
  killTerminal()
  process.exit(130)
}

function handleTermination() {
  killTerminal()
  process.exit(143)
}

function exitAfterBrokenPipe() {
  killTerminal()
  process.exit(1)
}

function send(message: BridgeMessage) {
  process.stdout.write(encodeLine(message))
}

function sendAndExit(message: BridgeMessage, exitCode: number) {
  process.stdout.write(encodeLine(message), () => process.exit(exitCode))
}

function encodeLine(message: BridgeMessage) {
  return `${JSON.stringify(message)}\n`
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
