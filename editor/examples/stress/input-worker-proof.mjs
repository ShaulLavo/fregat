export function installInputWorkerProof() {
  const NativeWorker = globalThis.Worker
  globalThis.__inputWorkerProof = []
  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      this.proof = {
        url: String(url),
        minimap: String(url).includes('minimap.worker'),
        terminated: false,
        sourceUpdates: 0,
        latestRender: 0,
        acceptedRender: 0,
        renders: 0,
      }
      globalThis.__inputWorkerProof.push(this.proof)
      this.addEventListener('message', ({ data }) => {
        if (data?.type !== 'rendered' || data.sequence !== this.proof.latestRender) return
        this.proof.acceptedRender = data.sequence
        this.proof.renders++
      })
    }

    postMessage(message, ...options) {
      if (this.proof.minimap && message && typeof message === 'object') {
        if (['openDocument', 'replaceDocument', 'applyEdit', 'applyEdits'].includes(message.type))
          this.proof.sourceUpdates++
        if (message.type === 'render') this.proof.latestRender = message.sequence
      }
      return super.postMessage(message, ...options)
    }

    terminate() {
      this.proof.terminated = true
      return super.terminate()
    }
  }
}
