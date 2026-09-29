// Page CDP heap reports omit workers. Attach to each worker isolate separately;
// backingStorageSize includes ArrayBuffers and external strings, not just WASM.
export async function workerHeaps(browser) {
  const cdp = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const heaps = []
    for (const target of targetInfos.filter((target) => target.type === 'worker'))
      heaps.push(await readWorkerHeap(cdp, target))
    return heaps
  } finally {
    await cdp.detach()
  }
}

async function readWorkerHeap(cdp, target) {
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  })
  try {
    await workerCommand(cdp, sessionId, 'HeapProfiler.collectGarbage')
    return { url: target.url, ...(await workerCommand(cdp, sessionId, 'Runtime.getHeapUsage')) }
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId })
  }
}

function workerCommand(cdp, sessionId, method) {
  return new Promise((resolve, reject) => {
    const receive = (event) => receiveWorkerResponse(event, sessionId, finish)
    const timer = setTimeout(() => finish(new Error(`Worker ${method} timeout`)), 10_000)
    function finish(error, result) {
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
      .catch((error) => finish(error))
  })
}

function receiveWorkerResponse(event, sessionId, finish) {
  if (event.sessionId !== sessionId) return
  const message = JSON.parse(event.message)
  if (message.id !== 1) return
  finish(message.error ? new Error(JSON.stringify(message.error)) : null, message.result)
}
