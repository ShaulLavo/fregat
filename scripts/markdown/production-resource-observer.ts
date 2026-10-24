import type { CDPSession, Page } from 'playwright'
import * as v from 'valibot'

import type { startProductionCdp } from './production-cdp'
import { withProductionDeadline } from './production-deadline'
import { createScriptError } from '../structured-errors'

type Instrumentation = Awaited<ReturnType<typeof startProductionCdp>>
const heapUsage = v.object({
  usedSize: v.pipe(v.number(), v.finite(), v.minValue(0)),
  totalSize: v.pipe(v.number(), v.finite(), v.minValue(0)),
  backingStorageSize: v.pipe(v.number(), v.finite(), v.minValue(0)),
})
const workerReply = v.object({
  id: v.number(),
  result: v.optional(v.unknown()),
  error: v.optional(v.unknown()),
})

type WorkerHeap = {
  readonly targetId: string
  readonly url: string
} & (
  | { readonly measurement: 'complete'; readonly heap: v.InferOutput<typeof heapUsage> }
  | { readonly measurement: 'unavailable'; readonly failure: string }
)

export async function observeProductionBrowserResources(
  instrumentation: Instrumentation,
  session: CDPSession,
) {
  const page = await withProductionDeadline(instrumentation.collect(), 'page resource collection')
  const workers = instrumentation.workers()
  const heaps: WorkerHeap[] = []
  for (const target of workers.targets) {
    if (target.detachedAtMs !== null) continue
    heaps.push(await observeWorkerHeap(session, target))
  }
  return { page, workers, heaps }
}

async function observeWorkerHeap(
  session: CDPSession,
  target: ReturnType<Instrumentation['workers']>['targets'][number],
): Promise<WorkerHeap> {
  try {
    const heap = await readWorkerHeap(session, target.targetId)
    return { targetId: target.targetId, url: target.url, measurement: 'complete', heap }
  } catch (error) {
    return {
      targetId: target.targetId,
      url: target.url,
      measurement: 'unavailable',
      failure: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readWorkerHeap(session: CDPSession, targetId: string) {
  const { sessionId } = await withProductionDeadline(
    session.send('Target.attachToTarget', { targetId, flatten: false }),
    'worker heap attachment',
  )
  try {
    await workerCommand(session, sessionId, 1, 'HeapProfiler.collectGarbage')
    return v.parse(heapUsage, await workerCommand(session, sessionId, 2, 'Runtime.getHeapUsage'))
  } finally {
    await withProductionDeadline(
      session.send('Target.detachFromTarget', { sessionId }),
      'worker heap detachment',
    )
  }
}

async function workerCommand(session: CDPSession, sessionId: string, id: number, method: string) {
  let receive: ((event: { sessionId: string; message: string }) => void) | undefined
  const reply = new Promise<unknown>((resolve, reject) => {
    receive = (event) => {
      if (event.sessionId !== sessionId) return
      acceptReply(event.message, id, resolve, reject)
    }
    session.on('Target.receivedMessageFromTarget', receive)
  })
  try {
    const [, result] = await withProductionDeadline(
      Promise.all([
        session.send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method }),
        }),
        reply,
      ]),
      method,
    )
    return result
  } finally {
    if (receive) session.off('Target.receivedMessageFromTarget', receive)
  }
}

function acceptReply(
  message: string,
  id: number,
  resolve: (value: unknown) => void,
  reject: (error: unknown) => void,
) {
  try {
    const parsed: unknown = JSON.parse(message)
    const reply = v.safeParse(workerReply, parsed)
    if (!reply.success || reply.output.id !== id) return
    if (reply.output.error) {
      reject(createScriptError('Worker heap collection failed.', { internal: { id } }))
      return
    }
    resolve(reply.output.result)
  } catch (error) {
    reject(error)
  }
}

export async function replaceProductionHighlightWorker(page: Page) {
  const workers = page
    .workers()
    .filter((worker) => new URL(worker.url()).pathname.includes('/shiki.worker-'))
  const worker = workers[0]
  if (workers.length !== 1 || !worker)
    throw createScriptError('Worker replacement requires one active highlighting worker.', {
      internal: { observed: workers.length, expected: 1 },
    })
  const closed = worker.waitForEvent('close', { timeout: 15_000 })
  await Promise.all([
    closed,
    worker.evaluate(() => {
      setTimeout(() => {
        throw new DOMException('Intentional production resource worker replacement', 'AbortError')
      }, 0)
    }),
  ])
  const replacement = page.waitForEvent('worker', {
    predicate: (candidate) => candidate.url() === worker.url(),
    timeout: 15_000,
  })
  const [next, rendered] = await Promise.all([
    replacement,
    page.evaluate(() =>
      window.markdownProductionProbe.resources(
        'Replacement **completed**.\n\n```ts\nconst replaced = 43\n```',
        [1],
        4,
      ),
    ),
  ])
  return { previousUrl: worker.url(), replacementUrl: next.url(), rendered }
}

export function observeProductionWorkerLifetimes(page: Page) {
  const lifetimes: {
    url: string
    createdAtMs: number
    closedAtMs: number | null
  }[] = []
  const created = (worker: ReturnType<Page['workers']>[number]) => {
    const lifetime: (typeof lifetimes)[number] = {
      url: worker.url(),
      createdAtMs: performance.now(),
      closedAtMs: null,
    }
    lifetimes.push(lifetime)
    worker.once('close', () => {
      lifetime.closedAtMs = performance.now()
    })
  }
  page.on('worker', created)
  return {
    read: () => lifetimes.map((lifetime) => ({ ...lifetime })),
    close: () => page.off('worker', created),
  }
}
