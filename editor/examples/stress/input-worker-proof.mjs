// Installed into the page before the app loads. It observes worker traffic without changing it,
// except for the probe-only readiness negatives, which a measured run never sets.
export function installInputWorkerProof(negative = null) {
  const NativeWorker = globalThis.Worker
  globalThis.__inputWorkerProof = []
  globalThis.__inputReadinessNegative = negative
  // Source each consumer session last received, rebuilt from the actual request payloads.
  globalThis.__inputWorkerSources = new Map()
  let corruptedTreeSitterEdit = false

  const kindOf = (url) => {
    if (url.includes('minimap.worker')) return 'minimap'
    if (url.includes('treeSitter.worker')) return 'treeSitter'
    if (url.includes('shiki.worker')) return 'shiki'
    return 'other'
  }

  // A session belongs to the worker that received it; terminating that worker ends the session
  // without a disposeDocument message.
  const sessionOf = (proof, id) => {
    const sessions = globalThis.__inputWorkerSources
    if (!sessions.has(id))
      sessions.set(id, {
        kind: proof.kind,
        worker: proof,
        id,
        text: null,
        chunks: new Map(),
        requested: 0,
        answered: 0,
        failed: 0,
        requestedVersion: null,
        answeredVersion: null,
        disposed: false,
      })
    return sessions.get(id)
  }

  // Shiki applies one batch of edits against the text before the batch, last position first.
  const applyEdits = (text, edits) => {
    const ordered = [...edits].sort((left, right) => right.from - left.from || right.to - left.to)
    let next = text
    for (const edit of ordered) next = next.slice(0, edit.from) + edit.text + next.slice(edit.to)
    return next
  }

  // Tree-sitter keeps sent chunks per session and forgets the ones a descriptor stops naming.
  const treeSitterSource = (session, source) => {
    for (const chunk of source.chunks) session.chunks.set(chunk.chunkId, chunk.text)
    const referenced = new Set(source.pieces.map((piece) => piece.chunkId))
    for (const chunkId of session.chunks.keys())
      if (!referenced.has(chunkId)) session.chunks.delete(chunkId)
    let text = ''
    for (const piece of source.pieces) {
      const chunk = session.chunks.get(piece.chunkId)
      if (chunk === undefined) return null
      text += chunk.slice(piece.start, piece.start + piece.length)
    }
    return text.length === source.length ? text : null
  }

  const observeRequest = (proof, message) => {
    const payload = message?.payload
    if (!payload || typeof payload !== 'object' || typeof message.id !== 'number') return
    const id = payload.runtimeSessionId
    if (typeof id !== 'string') return
    const session = sessionOf(proof, id)
    if (payload.type === 'disposeDocument') {
      session.disposed = true
      return
    }
    const shikiSource =
      proof.kind === 'shiki' && (payload.type === 'open' || payload.type === 'edit')
    const treeSource =
      proof.kind === 'treeSitter' && (payload.type === 'parse' || payload.type === 'edit')
    if (!shikiSource && !treeSource) return
    if (shikiSource)
      session.text =
        payload.type === 'open'
          ? payload.text
          : session.text === null
            ? null
            : applyEdits(session.text, payload.edits)
    if (treeSource) session.text = treeSitterSource(session, payload.source)
    session.requested = message.id
    session.requestedVersion = payload.snapshotVersion ?? null
    proof.requests.set(message.id, { session, type: payload.type })
  }

  const observeResponse = (proof, data) => {
    const request = proof.requests.get(data?.id)
    if (!request) return
    proof.requests.delete(data.id)
    if (data.id !== request.session.requested) return
    if (!data.ok) {
      request.session.failed = data.id
      return
    }
    request.session.answered = data.id
    request.session.answeredVersion = data.result?.snapshotVersion ?? null
  }

  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      this.proof = {
        url: String(url),
        kind: kindOf(String(url)),
        minimap: String(url).includes('minimap.worker'),
        terminated: false,
        sourceUpdates: 0,
        latestRender: 0,
        acceptedRender: 0,
        renders: 0,
      }
      Object.defineProperty(this.proof, 'requests', { value: new Map(), enumerable: false })
      globalThis.__inputWorkerProof.push(this.proof)
      this.addEventListener('message', (event) => {
        const { data } = event
        observeResponse(this.proof, data)
        if (data?.type !== 'rendered' || data.sequence !== this.proof.latestRender) return
        this.proof.acceptedRender = data.sequence
        this.proof.renders++
      })
    }

    postMessage(message, ...options) {
      const payload = message?.payload
      if (
        negative === 'corrupt-tree-sitter-edit' &&
        !corruptedTreeSitterEdit &&
        this.proof.kind === 'treeSitter' &&
        payload?.type === 'edit' &&
        payload.source.chunks.length > 0
      ) {
        // Probe-only negative: one current edit reaches the Tree-sitter worker with a changed
        // character, so that consumer parses text that differs from the document.
        corruptedTreeSitterEdit = true
        const [first, ...rest] = payload.source.chunks
        const last = first.text.at(-1)
        const text = first.text.slice(0, -1) + (last === 'x' ? 'y' : 'x')
        message = {
          ...message,
          payload: {
            ...payload,
            source: { ...payload.source, chunks: [{ ...first, text }, ...rest] },
          },
        }
      }
      observeRequest(this.proof, message)
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
