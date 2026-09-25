import { elapsedMs } from '@workspace/utils/timing'
import { spawn } from 'node:child_process'
import { QueryClient } from '@tanstack/query-core'

import { FsError } from './errors'
import { collectDecodedStreamTail, readLines } from './search-line-decoder'
import { limitText, recordRequestContext, recordRequestWarning } from '../observability'

type SearchToolRequirements = {
  content: boolean
  names: boolean
}

export type SearchToolWarning = {
  code: number
  command: string
  stderrTail: string
}

type SearchToolRunOptions = {
  cwd?: string
  onWarning?: (warning: SearchToolWarning) => void
}

const commandExists = createCommandAvailability()

export function createCommandAvailability(client = new QueryClient(), check = checkCommand) {
  return (command: string) => {
    const cwd = process.cwd()
    const env = { ...process.env }
    return client.query({
      queryKey: ['search', 'command', command, cwd, env.PATH ?? '', env.PATHEXT ?? ''],
      queryFn: () => check(command, { cwd, env }),
      // Missing tools become available on the next request after five seconds.
      staleTime: (query) => (query.state.data === true ? 300_000 : 5_000),
      gcTime: 300_000,
      networkMode: 'always',
      retry: false,
    })
  }
}

export async function canUseSearchTools(requirements: SearchToolRequirements) {
  if (requirements.names && !(await commandExists('fd'))) return false
  if (!requirements.content) return true

  return commandExists('rg')
}

export async function* runToolLines(
  command: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  successCodes: readonly number[],
  toleratedFailureCodes: readonly number[] = [],
  options: SearchToolRunOptions = {},
): AsyncGenerator<string> {
  const startedAt = performance.now()
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exit = waitForExit(child)
  const cleanup = attachAbort(signal, child)
  const stderr = collectDecodedStreamTail(child.stderr)
  let completed = false
  let lineCount = 0

  try {
    for await (const line of readLines(child.stdout)) {
      lineCount += 1
      yield line
    }
    completed = true
  } finally {
    cleanup()
    if (!completed) child.kill()
  }

  const code = await exit
  recordSearchToolRun(command, code, lineCount, elapsedMs(startedAt), signal?.aborted ?? false)
  if (successCodes.includes(code)) return
  if (signal?.aborted) return
  if (toleratedFailureCodes.includes(code)) {
    reportToolWarning(command, code, stderr(), options.onWarning)
    return
  }

  throw new FsError('OPERATION_FAILED', toolErrorMessage(command, code, stderr()))
}

function checkCommand(command: string, environment: { cwd: string; env: NodeJS.ProcessEnv }) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ['--version'], { ...environment, stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0))
  })
}

function reportToolWarning(
  command: string,
  code: number,
  stderr: string,
  onWarning?: (warning: SearchToolWarning) => void,
) {
  const stderrTail = stderr ? limitText(stderr, 500) : ''

  recordRequestWarning('search tool exited with tolerated failure', {
    area: 'search',
    code,
    command,
    operation: 'tool',
    stderrTail: stderrTail || undefined,
  })

  // The log line above is for us; the callback is how the user finds out their
  // results are incomplete. A tolerated exit means `rg` printed real matches and
  // also failed to read part of the tree, so a silent `done` would report a
  // partial result set as a complete one.
  onWarning?.({ code, command, stderrTail })
}

function toolErrorMessage(command: string, code: number, stderr: string) {
  if (!stderr) return `${command} exited with code ${code}`

  return `${command} exited with code ${code}: ${stderr}`
}

function attachAbort(signal: AbortSignal | undefined, child: ReturnType<typeof spawn>) {
  if (!signal) return () => {}

  const abort = () => child.kill()
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 0))
  })
}

function recordSearchToolRun(
  command: string,
  exitCode: number,
  lineCount: number,
  durationMs: number,
  aborted: boolean,
) {
  recordRequestContext({
    search: {
      tools: [
        {
          aborted,
          command,
          durationMs,
          exitCode,
          lineCount,
        },
      ],
    },
  })
}
