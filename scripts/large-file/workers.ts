import type { Browser, CDPSession } from 'playwright'
import * as v from 'valibot'
import { createScriptError } from '../structured-errors'

const heapSchema = v.object({
  usedSize: v.number(),
  totalSize: v.number(),
  backingStorageSize: v.number(),
})

export async function workerHeaps(browser: Browser) {
  const cdp = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const heaps = []
    for (const target of targetInfos.filter((target) => target.type === 'worker')) {
      const heap = await readWorker(cdp, target.targetId).catch((error: unknown) => ({
        unavailable: String(error),
      }))
      heaps.push({ url: target.url, heap })
    }
    return heaps
  } finally {
    await cdp.detach()
  }
}

async function readWorker(cdp: CDPSession, targetId: string) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false })
  try {
    await workerCommand(cdp, sessionId, 'HeapProfiler.collectGarbage')
    return v.parse(heapSchema, await workerCommand(cdp, sessionId, 'Runtime.getHeapUsage'))
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId })
  }
}

function workerCommand(cdp: CDPSession, sessionId: string, method: string) {
  return new Promise<unknown>((resolve, reject) => {
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
    function finish(error: unknown, result?: unknown) {
      clearTimeout(timer)
      cdp.off('Target.receivedMessageFromTarget', receive)
      if (error) reject(error)
      else resolve(result)
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
