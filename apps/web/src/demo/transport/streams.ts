export function eventStream(
  signal: AbortSignal,
  subscribe: (send: (event: string, data: unknown) => void) => () => void,
) {
  let cleanup = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = subscribeStream(controller, signal, subscribe)
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

function subscribeStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal,
  subscribe: (send: (event: string, data: unknown) => void) => () => void,
) {
  let closed = false
  const send = (event: string, data: unknown) => {
    if (!closed)
      controller.enqueue(
        new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      )
  }
  const unsubscribe = subscribe(send)
  const abort = () => {
    if (closed) return
    cleanup()
    controller.close()
  }
  const cleanup = () => {
    if (closed) return
    closed = true
    unsubscribe()
    signal.removeEventListener('abort', abort)
  }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  return cleanup
}

export function finiteEvents(events: readonly { type: string; [key: string]: unknown }[]) {
  const text = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
}
