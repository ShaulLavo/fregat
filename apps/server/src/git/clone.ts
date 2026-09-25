import { mkdir, mkdtemp, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import type { GitCloneProgressEvent, GitCloneStage } from '@workspace/contracts'
import type { WorkspacePaths } from '../fs/path'
import { recordRequestContext } from '../observability'
import { renameExclusive } from './utils/rename-exclusive'
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
  paths: WorkspacePaths
  signal?: AbortSignal
  source: string
  destination: string
  /** The destination as the client names it; the result carries this. */
  displayPath: string
  register: (absolutePath: string) => Promise<string | null>
}): AsyncGenerator<GitCloneProgressEvent> {
  const destination = await resolveCloneDestination(input.paths, input.destination)
  const existing = await maybeStat(destination)
  const url = cloneUrl(input.source)
  const refusal = await destinationRefusal(destination)
  if (refusal) {
    yield { kind: 'failed', message: refusal }
    return
  }
  await mkdir(path.dirname(destination), { recursive: true })
  yield { kind: 'progress', stage: 'connecting', percent: null }
  if (input.signal?.aborted) return
  const staging = await mkdtemp(path.join(path.dirname(destination), '.platform-clone-'))
  try {
    yield* cloneIntoOwnedDirectory(input, url, destination, staging, existing)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function* cloneIntoOwnedDirectory(
  input: Parameters<typeof cloneRepository>[0],
  url: string,
  destination: string,
  staging: string,
  existing: Awaited<ReturnType<typeof maybeStat>>,
): AsyncGenerator<GitCloneProgressEvent> {
  const child = Bun.spawn(['git', 'clone', '--progress', '--', url, staging], {
    cwd: path.dirname(destination),
    env: { ...process.env, GIT_PROGRESS_DELAY: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    detached: true,
  })
  const abort = () => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) abort()
  const timer = setTimeout(abort, CLONE_TIMEOUT_MS)
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
    if (input.signal?.aborted) return
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', abort)
    if (child.exitCode === null) abort()
    await child.exited
  }
  if (!(await publishClone(staging, destination, existing))) {
    yield { kind: 'failed', message: 'That destination changed while cloning.' }
    return
  }
  const projectId = await input.register(destination)
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

async function publishClone(
  staging: string,
  destination: string,
  existing: Awaited<ReturnType<typeof maybeStat>>,
) {
  if (!existing) return renameExclusive(staging, destination)
  const current = await maybeStat(destination)
  if (!current || current.ino !== existing.ino || current.dev !== existing.dev) return false
  try {
    // rmdir refuses concurrent files; the exclusive rename refuses a replacement directory.
    await rmdir(destination)
  } catch {
    return false
  }
  return renameExclusive(staging, destination)
}

async function resolveCloneDestination(
  paths: WorkspacePaths,
  destination: string,
): Promise<string> {
  const entry = await maybeStat(destination)
  if (entry) {
    const resolved = await realpath(destination)
    paths.assertRealInside(resolved)
    return resolved
  }
  const parent = await resolveCloneDestination(paths, path.dirname(destination))
  return path.join(parent, path.basename(destination))
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
