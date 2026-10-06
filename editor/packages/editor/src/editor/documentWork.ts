export function waitForDocumentWork<T>(result: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return result
  if (signal.aborted) {
    void result.catch(() => undefined)
    return Promise.reject(
      new DOMException('Document work was superseded or released', 'AbortError'),
    )
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(new DOMException('Document work was superseded or released', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
