import type { Browser, CDPSession } from '@playwright/test'
import { fail, stressError } from './errors.ts'

type WorkerTarget = { targetId: string; url: string }
type HeapUsage = {
  usedSize: number
  totalSize: number
  embedderHeapUsedSize: number
  backingStorageSize: number
}
// Page CDP heap reports omit workers. Attach to each worker isolate separately;
// backingStorageSize includes ArrayBuffers and external strings, not just WASM.
export async function workerHeaps(browser: Browser) {
  const cdp = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const heaps = []
    for (const target of targetInfos.filter((target: { type: string }) => target.type === 'worker'))
      heaps.push(await readWorkerHeap(cdp, target))
    return heaps
  } finally {
    await cdp.detach()
  }
}

async function readWorkerHeap(cdp: CDPSession, target: WorkerTarget) {
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  })
  try {
    await workerCommand(cdp, sessionId, 'HeapProfiler.collectGarbage')
    const usage = await workerCommand(cdp, sessionId, 'Runtime.getHeapUsage')
    if (!isHeapUsage(usage)) fail('Worker returned an invalid heap measurement')
    return { url: target.url, ...usage }
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId })
  }
}

function workerCommand(cdp: CDPSession, sessionId: string, method: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const receive = (event: { sessionId: string; message: string }) =>
      receiveWorkerResponse(event, sessionId, finish)
    const timer = setTimeout(() => finish(stressError(`Worker ${method} timeout`)), 10_000)
    function finish(error: Error | null, result?: unknown) {
      clearTimeout(timer)
      cdp.off('Target.receivedMessageFromTarget', receive)
      if (error) reject(error)
      else resolve(result)
    }
    cdp.on('Target.receivedMessageFromTarget', receive)
    cdp
      .send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: 1, method }),
      })
      .catch((error: Error | null) => finish(error))
  })
}

function receiveWorkerResponse(
  event: { sessionId: string; message: string },
  sessionId: string,
  finish: (error: Error | null, result?: unknown) => void,
) {
  if (event.sessionId !== sessionId) return
  const message: unknown = JSON.parse(event.message)
  if (!message || typeof message !== 'object' || !('id' in message) || message.id !== 1) return
  const error = 'error' in message ? message.error : undefined
  finish(
    error ? stressError(JSON.stringify(error)) : null,
    'result' in message ? message.result : undefined,
  )
}

function isHeapUsage(value: unknown): value is HeapUsage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'usedSize' in value &&
    typeof value.usedSize === 'number' &&
    'totalSize' in value &&
    typeof value.totalSize === 'number' &&
    'embedderHeapUsedSize' in value &&
    typeof value.embedderHeapUsedSize === 'number' &&
    'backingStorageSize' in value &&
    typeof value.backingStorageSize === 'number'
  )
}
