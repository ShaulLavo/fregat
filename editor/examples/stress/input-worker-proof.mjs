// Capture keeps existing message fragments; readiness replays them outside measured intervals.
// Only probe-only negatives alter messages; measured runs never enable them.
export function installInputWorkerProof(negative = null) {
  const NativeWorker = globalThis.Worker
  globalThis.__inputWorkerProof = []
  globalThis.__inputWorkerSources = new Map()
  globalThis.__inputReadinessNegative = negative
  let corruptedTreeSitterEdit = false
  let droppedMinimapEdit = false

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
        log: [],
        requested: 0,
        answered: 0,
        failed: 0,
        requestedVersion: null,
        answeredVersion: null,
        disposed: false,
      })
    return sessions.get(id)
  }

  const releaseSession = (proof, id, session) => {
    session.disposed = true
    session.log.length = 0
    for (const [request, owner] of proof.requests)
      if (owner === session) proof.requests.delete(request)
    globalThis.__inputWorkerSources.delete(id)
    proof.disposedSessions++
  }

  const observeSource = (proof, message) => {
    const payload = message?.payload
    if (!payload || typeof payload !== 'object' || typeof message.id !== 'number') return
    const id = payload.runtimeSessionId
    if (typeof id !== 'string') return
    const session = sessionOf(proof, id)
    if (payload.type === 'disposeDocument') {
      releaseSession(proof, id, session)
      return
    }
    const shiki = proof.kind === 'shiki' && (payload.type === 'open' || payload.type === 'edit')
    const tree =
      proof.kind === 'treeSitter' && (payload.type === 'parse' || payload.type === 'edit')
    if (!shiki && !tree) return
    session.log.push(payload)
    session.requested = message.id
    session.requestedVersion = payload.snapshotVersion ?? null
    proof.requests.set(message.id, session)
  }

  const observeMinimap = (proof, message) => {
    if (!message || typeof message !== 'object') return
    if (['openDocument', 'replaceDocument', 'applyEdit', 'applyEdits'].includes(message.type)) {
      proof.sourceUpdates++
      // A full replacement supersedes prior payloads; freshness keeps its monotonic generation.
      if (message.type === 'openDocument' || message.type === 'replaceDocument')
        proof.minimapLog.length = 0
      proof.minimapLog.push(message)
    }
    if (message.type === 'render') {
      proof.latestRender = message.sequence
      proof.renderAfterSource = proof.sourceUpdates
    }
  }

  const observeResponse = (proof, data) => {
    const session = proof.requests.get(data?.id)
    if (!session) return
    proof.requests.delete(data.id)
    if (data.id !== session.requested) return
    if (!data.ok) {
      session.failed = data.id
      return
    }
    session.answered = data.id
    session.answeredVersion = data.result?.snapshotVersion ?? null
  }

  const liveMinimaps = () =>
    globalThis.__inputWorkerProof.filter((worker) => worker.minimap && !worker.terminated)

  // Probe-only negatives: one Tree-sitter edit reaches its worker with a changed character, or one
  // minimap view misses its first edit after input while the others receive theirs.
  const negativeMessage = (proof, message) => {
    const payload = message?.payload
    if (
      negative === 'corrupt-tree-sitter-edit' &&
      !corruptedTreeSitterEdit &&
      proof.kind === 'treeSitter' &&
      payload?.type === 'edit' &&
      payload.source.chunks.length > 0
    ) {
      corruptedTreeSitterEdit = true
      const [first, ...rest] = payload.source.chunks
      const text = first.text.slice(0, -1) + (first.text.at(-1) === 'x' ? 'y' : 'x')
      const chunks = [{ ...first, text }, ...rest]
      return { ...message, payload: { ...payload, source: { ...payload.source, chunks } } }
    }
    if (
      negative === 'stale-minimap-view' &&
      !droppedMinimapEdit &&
      liveMinimaps()[1] === proof &&
      (message?.type === 'applyEdit' || message?.type === 'applyEdits')
    ) {
      droppedMinimapEdit = true
      return null
    }
    return message
  }

  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      const kind = kindOf(String(url))
      this.proof = {
        url: String(url),
        kind,
        minimap: kind === 'minimap',
        terminated: false,
        disposedSessions: 0,
        sourceUpdates: 0,
        latestRender: 0,
        acceptedRender: 0,
        renderAfterSource: 0,
        renders: 0,
      }
      Object.defineProperty(this.proof, 'requests', { value: new Map(), enumerable: false })
      Object.defineProperty(this.proof, 'minimapLog', { value: [], enumerable: false })
      globalThis.__inputWorkerProof.push(this.proof)
      this.addEventListener('message', ({ data }) => {
        observeResponse(this.proof, data)
        if (data?.type !== 'rendered' || data.sequence !== this.proof.latestRender) return
        this.proof.acceptedRender = data.sequence
        this.proof.renders++
      })
    }

    postMessage(message, ...options) {
      const sent = negative ? negativeMessage(this.proof, message) : message
      if (sent === null) return undefined
      if (this.proof.minimap) observeMinimap(this.proof, sent)
      else observeSource(this.proof, sent)
      return super.postMessage(sent, ...options)
    }

    terminate() {
      this.proof.terminated = true
      for (const [id, session] of globalThis.__inputWorkerSources)
        if (session.worker === this.proof) releaseSession(this.proof, id, session)
      this.proof.requests.clear()
      this.proof.minimapLog.length = 0
      return super.terminate()
    }
  }
}

// Readiness replays run after the measured interval, from the fragments recorded above.

/** Shiki: the open text, then each batch of edits against the text before it, last position first. */
export function replayShikiSource(log) {
  let text = null
  for (const payload of log) {
    if (payload.type === 'open') {
      text = payload.text
      continue
    }
    if (text === null) return null
    const ordered = [...payload.edits].sort(
      (left, right) => right.from - left.from || right.to - left.to,
    )
    for (const edit of ordered) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
  }
  return text
}

/** Tree-sitter: the worker's chunk cache rules, then the last descriptor's pieces. */
export function replayTreeSitterSource(log) {
  const chunks = new Map()
  let text = null
  for (const { source } of log) {
    for (const chunk of source.chunks) chunks.set(chunk.chunkId, chunk.text)
    const referenced = new Set(source.pieces.map((piece) => piece.chunkId))
    for (const chunkId of chunks.keys()) if (!referenced.has(chunkId)) chunks.delete(chunkId)
    text = ''
    for (const piece of source.pieces) {
      const chunk = chunks.get(piece.chunkId)
      if (chunk === undefined) return null
      text += chunk.slice(piece.start, piece.start + piece.length)
    }
    if (text.length !== source.length) return null
  }
  return text
}

/** Minimap: the line summaries the worker holds after its document and every summary patch. */
export function replayMinimapLines(log) {
  let lines = null
  let textLength = null
  for (const message of log) {
    if (message.type === 'openDocument' || message.type === 'replaceDocument') {
      lines = [...message.document.lines]
      textLength = message.document.textLength
      continue
    }
    if (lines === null) return null
    const patch = message.document.summaryPatch
    lines.splice(patch.startLine, patch.deleteCount, ...patch.lines)
    textLength = patch.textLength
  }
  return lines === null ? null : { lines, textLength }
}

/** A minimap line summary matches a line when its length is exact and its text is a prefix. */
export function minimapMatches(replayed, text) {
  if (!replayed || replayed.textLength !== text.length) return false
  const lines = text.split('\n')
  if (replayed.lines.length !== lines.length) return false
  return replayed.lines.every(
    (summary, index) =>
      summary.length === lines[index].length && lines[index].startsWith(summary.text),
  )
}
