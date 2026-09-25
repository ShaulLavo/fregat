import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { GitCloneProgressEvent, GitCloneStage } from '@workspace/contracts'
import { recordRequestContext } from '../observability'
import { maybeStat } from './utils/worktree-paths'

/** A repository slow to transfer is healthy; one that never finishes is not. */
const CLONE_TIMEOUT_MS = 30 * 60_000
const FAILURE_TAIL_LINES = 4

const STAGES: ReadonlyArray<[RegExp, GitCloneStage]> = [
  [/(Enumerating|Counting|Compressing) objects/, 'counting'],
  [/Receiving objects/, 'receiving'],
  [/Resolving deltas/, 'resolving'],
  [/(Updating|Checking out) files/, 'checkout'],
]

/**
 * `git clone` into an empty or new folder, reported as it runs. A failed or abandoned clone
 * leaves nothing behind it created, and only a finished checkout is registered as a project,
 * so a half-cloned folder never becomes one. Ported from upstream `SourceControlRepositoryService`.
 */
export async function* cloneRepository(input: {
  source: string
  destination: string
  /** The destination as the client names it; the result carries this. */
  displayPath: string
  register: (absolutePath: string) => Promise<string | null>
}): AsyncGenerator<GitCloneProgressEvent> {
  const url = cloneUrl(input.source)
  const refusal = await destinationRefusal(input.destination)
  if (refusal) {
    yield { kind: 'failed', message: refusal }
    return
  }
  const existed = (await maybeStat(input.destination)) !== null
  await mkdir(path.dirname(input.destination), { recursive: true })
  yield { kind: 'progress', stage: 'connecting', percent: null }
  const child = Bun.spawn(['git', 'clone', '--progress', '--', url, input.destination], {
    cwd: path.dirname(input.destination),
    env: { ...process.env, GIT_PROGRESS_DELAY: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), CLONE_TIMEOUT_MS)
  let finished = false
  const tail: string[] = []
  try {
    for await (const line of progressLines(child.stderr)) {
      const progress = parseCloneProgress(line)
      if (progress) {
        yield { kind: 'progress', ...progress }
        continue
      }
      if (!line.startsWith('Cloning into')) tail.push(line)
      if (tail.length > FAILURE_TAIL_LINES) tail.shift()
    }
    const exitCode = await child.exited
    recordRequestContext({ git: { operation: 'clone', exitCode } })
    if (exitCode !== 0) {
      yield {
        kind: 'failed',
        message: redact(tail.join('\n')) || 'The repository could not be cloned.',
      }
      return
    }
    finished = true
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill()
    // Cancelled or failed: the folder goes back to how it was found.
    if (!finished) await discard(input.destination, existed)
  }
  const projectId = await input.register(input.destination)
  yield { kind: 'result', path: input.displayPath, projectId }
}

/** `owner/repo` is GitHub shorthand, as upstream reads a pasted name; anything else is a URL. */
export function cloneUrl(source: string) {
  const trimmed = source.trim()
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed))
    return `https://github.com/${trimmed.replace(/\.git$/, '')}.git`
  return trimmed
}

export function parseCloneProgress(
  line: string,
): { stage: GitCloneStage; percent: number | null } | null {
  const stage = STAGES.find(([pattern]) => pattern.test(line))?.[1]
  if (!stage) return null
  const percent = /:\s+(\d+)%/.exec(line)?.[1]
  return { stage, percent: percent === undefined ? null : Number(percent) }
}

async function destinationRefusal(destination: string) {
  const stat = await maybeStat(destination)
  if (!stat) return null
  if (!stat.isDirectory()) return 'That path exists and is not a folder.'
  if ((await readdir(destination)).length > 0) return 'That folder is not empty.'
  return null
}

async function discard(destination: string, existed: boolean) {
  if (!existed) {
    await rm(destination, { recursive: true, force: true })
    return
  }
  // An empty folder the user chose stays; only what the clone wrote goes.
  for (const entry of await readdir(destination).catch(() => [])) {
    await rm(path.join(destination, entry), { recursive: true, force: true })
  }
}

/** Git separates progress updates with carriage returns and lines with newlines. */
async function* progressLines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true })
    const lines = buffered.split(/[\r\n]/)
    buffered = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) yield line.trim()
  }
  if (buffered.trim()) yield buffered.trim()
}

/** Credentials in a URL git echoes back never reach the client. */
function redact(text: string) {
  return text.replace(/(\w+:\/\/)[^/@\s]+@/g, '$1')
}
