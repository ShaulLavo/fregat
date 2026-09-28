import type { Browser, CDPSession } from 'playwright'
import { createScriptError } from '../structured-errors'

type WorkerHeap = {
  readonly usedSize: number
  readonly totalSize: number
  readonly backingStorageSize: number
}

export async function workerHeaps(browser: Browser) {
  const cdp = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const heaps = []
    for (const target of targetInfos.filter((target) => target.type === 'worker'))
      heaps.push({ url: target.url, heap: await readWorker(cdp, target.targetId) })
    return heaps
  } finally {
    await cdp.detach()
  }
}

async function readWorker(cdp: CDPSession, targetId: string) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false })
  try {
    await workerCommand(cdp, sessionId, 'HeapProfiler.collectGarbage')
    return await workerCommand(cdp, sessionId, 'Runtime.getHeapUsage')
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId })
  }
}

function workerCommand(cdp: CDPSession, sessionId: string, method: string) {
  return new Promise<WorkerHeap>((resolve, reject) => {
    const receive = (event: { sessionId: string; message: string }) => {
      if (event.sessionId !== sessionId) return
      const message = JSON.parse(event.message)
      if (message.id !== 1) return
      finish(
        message.error ? createScriptError(JSON.stringify(message.error)) : null,
        message.result,
      )
    }
    const timer = setTimeout(() => finish(createScriptError(`Worker ${method} timeout`)), 10_000)
    function finish(error: unknown, result?: WorkerHeap) {
      clearTimeout(timer)
      cdp.off('Target.receivedMessageFromTarget', receive)
      if (error) reject(error)
      else resolve(result as WorkerHeap)
    }
    cdp.on('Target.receivedMessageFromTarget', receive)
    void cdp
      .send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: 1, method }),
      })
      .catch((error) => finish(error))
  })
}
