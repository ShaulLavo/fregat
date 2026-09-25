import { AsyncLocalStorage } from 'node:async_hooks'
import { realpath } from 'node:fs/promises'
import path from 'node:path'

const pending = new Map<string, Promise<void>>()
type RepositoryLease = { valid: boolean }
const active = new AsyncLocalStorage<ReadonlyMap<string, RepositoryLease>>()

type CommonDirectoryRunner = {
  readonly rootAbsolutePath: string
  run: (args: readonly string[]) => Promise<{ readonly stdout: string }>
}

export function outsideGitRepositoryLane<T>(action: () => T): T {
  return active.run(new Map(), action)
}

/** Realpath'd, so a symlinked root and its target key one lane and one fetch throttle. */
export async function gitCommonDirectory(runner: CommonDirectoryRunner) {
  const result = await runner.run(['rev-parse', '--git-common-dir'])
  return realpath(path.resolve(runner.rootAbsolutePath, result.stdout.trim()))
}

export async function withGitRepositoryLane<T>(commonDirectory: string, action: () => Promise<T>) {
  if (holdsLane(commonDirectory)) return action()

  const { context, release } = await acquireLane(commonDirectory)
  try {
    return await active.run(context, action)
  } finally {
    release()
  }
}

export async function* withGitRepositoryLaneStream<T>(
  commonDirectory: string,
  source: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  if (holdsLane(commonDirectory)) {
    yield* source()
    return
  }
  const { context, release } = await acquireLane(commonDirectory)
  const iterator = active.run(context, source)
  try {
    while (true) {
      const next = await active.run(context, () => iterator.next())
      if (next.done) return
      yield next.value
    }
  } finally {
    await active.run(context, () => iterator.return(undefined)).finally(release)
  }
}

function holdsLane(commonDirectory: string) {
  return active.getStore()?.get(commonDirectory)?.valid === true
}

async function acquireLane(commonDirectory: string) {
  const previous = pending.get(commonDirectory) ?? Promise.resolve()
  const completion = Promise.withResolvers<void>()
  pending.set(commonDirectory, completion.promise)
  await previous
  const lease = { valid: true }
  const context = new Map([...(active.getStore() ?? []), [commonDirectory, lease]])
  const release = () => {
    lease.valid = false
    completion.resolve()
    if (pending.get(commonDirectory) === completion.promise) pending.delete(commonDirectory)
  }
  return { context, release }
}
