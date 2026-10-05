import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect } from 'node:util'

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

export async function archiveRetentionReloadArtifact(
  output: string,
  name: string,
  payload: unknown,
) {
  const failures: unknown[] = []
  try {
    await writeFile(join(output, name), JSON.stringify(payload))
  } catch (error) {
    failures.push(error)
    try {
      const diagnostic = inspect(
        { artifact: name, failures, payload },
        {
          depth: null,
          maxArrayLength: null,
          maxStringLength: null,
          customInspect: false,
        },
      )
      await writeFile(join(output, name + '.fallback.txt'), diagnostic)
    } catch (fallbackError) {
      failures.push(fallbackError)
    }
  }
  return failures
}

export function archiveRetentionReloadFailure(output: string, payload: unknown) {
  return archiveRetentionReloadArtifact(output, 'failed-raw.json', payload)
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
