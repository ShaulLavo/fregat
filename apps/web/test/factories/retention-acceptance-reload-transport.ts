import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createRetentionReloadTransport() {
  const tasks = new Set<Promise<void>>()
  const failures: { url: string; at: number; stage: string; error: string }[] = []
  let firstError: unknown
  let fail: (error: unknown) => void = () => {}
  const failure = new Promise<unknown>((resolve) => {
    fail = resolve
  })
  const record = (url: string, stage: string, error: unknown) => {
    failures.push({
      url,
      at: Date.now(),
      stage,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const handleFailure = async (url: string, error: unknown) => {
    record(url, 'forward', error)
    if (failures.length === 1) {
      firstError = error
      fail(error)
    }
  }
  const abortFailed = async (url: string, abort: () => Promise<void>) => {
    try {
      await abort()
    } catch (error) {
      record(url, 'abort', error)
    }
  }
  return {
    failures,
    get firstError() {
      return firstError
    },
    async race<T>(operation: Promise<T>): Promise<T> {
      return Promise.race([
        operation,
        failure.then((error): never => {
          throw error
        }),
      ])
    },
    run(url: string, operation: () => Promise<void>, abort: () => Promise<void>) {
      const task = Promise.resolve()
        .then(operation)
        .catch(async (error: unknown) => {
          await handleFailure(url, error)
          await abortFailed(url, abort)
        })
      tasks.add(task)
      return task.finally(() => {
        tasks.delete(task)
      })
    },
    async drain() {
      await Promise.all(tasks)
    },
  }
}

export async function archiveRetentionReloadFailure(output: string, payload: unknown) {
  await writeFile(join(output, 'failed-raw.json'), JSON.stringify(payload))
}

export async function settleRetentionReloadCleanup(
  actions: readonly {
    readonly stage: string
    readonly run: () => Promise<unknown>
  }[],
) {
  const outcomes: { stage: string; at: number; error: unknown }[] = []
  for (const action of actions) {
    try {
      await action.run()
      outcomes.push({ stage: action.stage, at: Date.now(), error: null })
    } catch (error) {
      outcomes.push({ stage: action.stage, at: Date.now(), error })
    }
  }
  return outcomes
}
