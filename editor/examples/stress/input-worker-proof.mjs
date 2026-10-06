// Capture retains original message fragments; replay and DOM visibility checks run after input.
// Probe-only negatives change bytes. Accepted measurements send the original messages.
export function installInputWorkerProof(negative = null) {
  const NativeWorker = globalThis.Worker
  globalThis.__inputWorkerProof = []
  globalThis.__inputWorkerSources = new Map()
  globalThis.__inputReadinessNegative = negative
  let corruptedTreeSitterEdit = false
  let droppedMinimapEdit = false
  const canvasViews = new WeakMap()
  const transfer = globalThis.HTMLCanvasElement?.prototype.transferControlToOffscreen
  if (transfer)
    globalThis.HTMLCanvasElement.prototype.transferControlToOffscreen = function (...args) {
      const canvas = transfer.apply(this, args)
      canvasViews.set(canvas, this.closest('[id^="view-"]')?.id ?? null)
      return canvas
    }
  const identityKey = (identity) =>
    identity &&
    JSON.stringify([
      identity.documentId,
      identity.documentGeneration,
      identity.endpointGeneration,
      identity.registrationId,
    ])
  const pointKey = (point) =>
    point == null ? null : JSON.stringify([point.segment, point.revision, point.textVersion])
  const samePoint = (left, right) => pointKey(left) === pointKey(right)
  const sameIdentity = (left, right) =>
    Boolean(left && right && identityKey(left) === identityKey(right))
  const sameReference = (left, right) =>
    Boolean(
      left &&
      right &&
      left.readId === right.readId &&
      sameIdentity(left.identity, right.identity) &&
      samePoint(left.point, right.point),
    )
  const sameReceipt = (left, right) =>
    Boolean(
      left &&
      right &&
      left.kind === right.kind &&
      sameIdentity(left.identity, right.identity) &&
      samePoint(left.base, right.base) &&
      samePoint(left.target, right.target),
    )
  const kindOf = (url) => {
    if (url.includes('minimap.worker')) return 'minimap'
    if (url.includes('treeSitter.worker')) return 'treeSitter'
    if (url.includes('shiki.worker')) return 'shiki'
    return 'other'
  }
  const sessionOf = (proof, id) => {
    const key = `${proof.instance}/${id}`
    const sessions = globalThis.__inputWorkerSources
    if (!sessions.has(key))
      sessions.set(key, {
        kind: proof.kind,
        worker: proof,
        runtimeSessionId: id,
        log: [],
        requested: 0,
        answered: 0,
        failed: 0,
        requestedVersion: null,
        answeredVersion: null,
        disposed: false,
        canonical: null,
      })
    return sessions.get(key)
  }
  const releaseSession = (proof, key, session) => {
    session.disposed = true
    session.log.length = 0
    session.canonical = null
    for (const [request, owner] of proof.requests)
      if (owner === session) proof.requests.delete(request)
    proof.pendingWorkerRequests = proof.requests.size
    globalThis.__inputWorkerSources.delete(key)
    proof.disposedSessions++
  }
  const sourceOf = (proof, identity) => {
    const key = identityKey(identity)
    if (!proof.documents.has(key))
      proof.documents.set(key, { identity, log: [], acknowledged: null })
    return proof.documents.get(key)
  }
  const releaseSource = (proof, command) => {
    const key = identityKey(command.identity)
    const source = proof.documents.get(key)
    if (source) source.log.length = 0
    proof.documents.delete(key)
    for (const [request, pending] of proof.sourceRequests) {
      if (sameIdentity(pending.entry.command.identity, command.identity))
        proof.sourceRequests.delete(request)
    }
    proof.pendingSourceRequests = proof.sourceRequests.size
    for (const session of globalThis.__inputWorkerSources.values()) {
      if (
        session.worker === proof &&
        sameIdentity(session.canonical?.reference.identity, command.identity)
      )
        session.canonical.loan?.source.log.splice(0)
    }
    for (const [readId, loan] of proof.reads)
      if (sameIdentity(loan.reference.identity, command.identity)) proof.reads.delete(readId)
  }
  const observeCommand = (proof, message) => {
    const command = message.payload.command
    if (!command?.identity) return
    if (command.kind === 'release') return releaseSource(proof, command)
    if (command.kind === 'unpin') return proof.reads.delete(command.readId)
    const source = sourceOf(proof, command.identity)
    const entry = { command, receipt: null, expectedBase: source.acknowledged }
    if (command.kind === 'reset') source.log = [entry]
    if (command.kind === 'advance') source.log.push(entry)
    if (command.kind === 'importRead')
      entry.imported = {
        identity: command.identity,
        log: [entry],
        acknowledged: command.point,
        owner: source,
      }
    proof.sourceRequests.set(message.id, { source, entry })
    proof.pendingSourceRequests = proof.sourceRequests.size
  }
  const observeSource = (proof, message) => {
    const payload = message?.payload
    if (!payload || typeof payload !== 'object' || typeof message.id !== 'number') return
    if (payload.type === 'source') return observeCommand(proof, message)
    const id = payload.runtimeSessionId
    if (typeof id !== 'string') return
    const session = sessionOf(proof, id)
    if (payload.type === 'disposeDocument')
      return releaseSession(proof, `${proof.instance}/${id}`, session)
    const work = proof.kind === 'shiki' ? ['open', 'edit'] : ['parse', 'edit']
    if (!work.includes(payload.type)) return
    if (payload.source?.identity) {
      session.log = [payload]
      session.canonical = {
        reference: payload.source,
        loan: proof.reads.get(payload.source.readId) ?? null,
      }
    } else {
      session.canonical = null
      session.log.push(payload)
    }
    session.requested = message.id
    session.requestedVersion = payload.snapshotVersion ?? null
    proof.requests.set(message.id, session)
    proof.pendingWorkerRequests = proof.requests.size
  }
  const observeMinimap = (proof, message) => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'init') proof.viewId = canvasViews.get(message.mainCanvas) ?? null
    if (message.type === 'releaseSource') {
      proof.minimapLog.length = 0
      proof.minimapSource = null
      proof.sourceAcknowledged = false
      for (const [id, pending] of proof.projectRequests)
        if (sameIdentity(pending.message.identity, message.identity))
          proof.projectRequests.delete(id)
      proof.pendingSourceRequests = proof.projectRequests.size
      proof.sourceReceipt = null
      proof.attestedRenderedSource = null
      return
    }
    if (message.type === 'projectSource') {
      proof.protocol = 'canonical'
      proof.sourceUpdates++
      if (message.projection.kind === 'reset') proof.minimapLog.length = 0
      const entry = {
        message,
        receipt: null,
        expectedBase: proof.minimapSource?.receipt?.target ?? null,
      }
      proof.minimapLog.push(entry)
      proof.minimapSource = entry
      proof.sourceAcknowledged = false
      proof.projectRequests.set(message.requestId, entry)
      proof.pendingSourceRequests = proof.projectRequests.size
      proof.sourceReceipt = null
    }
    if (['openDocument', 'replaceDocument', 'applyEdit', 'applyEdits'].includes(message.type)) {
      proof.protocol = 'legacy'
      proof.sourceUpdates++
      if (['openDocument', 'replaceDocument'].includes(message.type)) proof.minimapLog.length = 0
      proof.minimapLog.push(message)
    }
    if (message.type !== 'render') return
    proof.latestRender = message.sequence
    proof.renderAfterSource = proof.sourceUpdates
    proof.renderSource = message.source ?? null
    proof.requestedRenderSource = message.source ?? null
    proof.renderRequests.set(message.sequence, message.source ?? null)
    proof.pendingRenderRequests = proof.renderRequests.size
    proof.renderSourceMatched =
      proof.protocol === 'canonical' &&
      proof.sourceAcknowledged &&
      sameReceipt(message.source, proof.minimapSource?.receipt)
    proof.acceptedSourceMatched = false
  }
  const sourceResponse = (proof, data) => {
    const pending = proof.sourceRequests.get(data?.id)
    if (!pending) return
    proof.sourceRequests.delete(data.id)
    proof.pendingSourceRequests = proof.sourceRequests.size
    const { source, entry } = pending
    const { command } = entry
    const receipt = data.ok ? (data.result?.source ?? data.result) : null
    if (!receipt) return
    if (command.kind === 'reset' || command.kind === 'advance') {
      const valid =
        receipt.kind === 'applied' &&
        sameIdentity(receipt.identity, command.identity) &&
        samePoint(receipt.base, command.base) &&
        samePoint(receipt.target, command.target) &&
        samePoint(command.base, entry.expectedBase)
      if (!valid) return
      entry.receipt = receipt
      source.acknowledged = receipt.target
      return
    }
    if (command.kind !== 'pin' && command.kind !== 'importRead') return
    const reference = { identity: command.identity, point: command.point, readId: command.readId }
    if (receipt.kind !== 'pinned' || !sameReference(receipt.reference, reference)) return
    entry.receipt = receipt
    proof.reads.set(command.readId, {
      reference: receipt.reference,
      source: entry.imported ?? source,
    })
  }
  const observeResponse = (proof, data) => {
    sourceResponse(proof, data)
    const session = proof.requests.get(data?.id)
    if (!session) return
    proof.requests.delete(data.id)
    proof.pendingWorkerRequests = proof.requests.size
    if (data.id !== session.requested) return
    if (!data.ok) {
      session.failed = data.id
      return
    }
    session.answered = data.id
    session.answeredVersion = data.result?.snapshotVersion ?? null
  }
  const projectedResponse = (proof, data) => {
    const entry = proof.projectRequests.get(data?.requestId)
    if (!entry) {
      proof.staleResponses++
      return
    }
    const message = entry.message
    const receipt = data.receipt
    const valid =
      receipt?.kind === 'applied' &&
      sameIdentity(receipt.identity, message.identity) &&
      samePoint(receipt.base, message.base) &&
      samePoint(receipt.target, message.target)
    if (!valid) {
      proof.staleResponses++
      return
    }
    entry.receipt = receipt
    proof.projectRequests.delete(data.requestId)
    proof.pendingSourceRequests = proof.projectRequests.size
    if (entry !== proof.minimapSource) return
    proof.sourceAcknowledged = true
    proof.sourceReceipt = receipt
  }
  const observeMinimapResponse = (proof, data) => {
    if (data?.type === 'error') proof.failedResponses++
    if (data?.type === 'renderSkipped') {
      if (!proof.renderRequests.has(data.sequence)) {
        proof.staleResponses++
        return
      }
      proof.renderRequests.delete(data.sequence)
      proof.pendingRenderRequests = proof.renderRequests.size
      proof.canceledRenders++
      return
    }
    if (data?.type === 'sourceApplied') projectedResponse(proof, data)
    if (data?.type === 'rendered') {
      const requested = proof.renderRequests.get(data.sequence)
      const registered = proof.renderRequests.has(data.sequence)
      const valid =
        registered && (proof.protocol !== 'canonical' || sameReceipt(data.source, requested))
      if (valid) {
        proof.renderRequests.delete(data.sequence)
        proof.pendingRenderRequests = proof.renderRequests.size
      } else proof.staleResponses++
    }
    if (data?.type !== 'rendered' || data.sequence !== proof.latestRender) return
    if (proof.protocol === 'canonical')
      proof.acceptedSourceMatched = sameReceipt(data.source, proof.renderSource)
    proof.acceptedRenderSource = data.source ?? null
    proof.acceptedRender = data.sequence
    proof.renders++
  }
  const liveMinimaps = () =>
    globalThis.__inputWorkerProof.filter((worker) => worker.minimap && !worker.terminated)
  const corruptCanonicalEdit = (message) => {
    const command = message.payload.command
    if (command.kind !== 'advance' || !command.edits.some((edit) => edit.text.length))
      return message
    corruptedTreeSitterEdit = true
    let changed = false
    const edits = command.edits.map((edit) => {
      if (changed || !edit.text.length) return edit
      changed = true
      const text = edit.text.slice(0, -1) + (edit.text.at(-1) === 'x' ? 'y' : 'x')
      return { ...edit, text }
    })
    return { ...message, payload: { ...message.payload, command: { ...command, edits } } }
  }
  const negativeMessage = (proof, message) => {
    const payload = message?.payload
    if (
      negative === 'corrupt-tree-sitter-edit' &&
      !corruptedTreeSitterEdit &&
      proof.kind === 'treeSitter' &&
      payload?.type === 'source'
    )
      return corruptCanonicalEdit(message)
    if (
      negative === 'corrupt-tree-sitter-edit' &&
      !corruptedTreeSitterEdit &&
      proof.kind === 'treeSitter' &&
      payload?.type === 'edit' &&
      Array.isArray(payload.source?.chunks) &&
      payload.source.chunks.length
    ) {
      corruptedTreeSitterEdit = true
      const [first, ...rest] = payload.source.chunks
      const text = first.text.slice(0, -1) + (first.text.at(-1) === 'x' ? 'y' : 'x')
      return {
        ...message,
        payload: {
          ...payload,
          source: { ...payload.source, chunks: [{ ...first, text }, ...rest] },
        },
      }
    }
    const minimapPatch =
      message?.type === 'projectSource'
        ? message.projection.kind === 'patch'
        : ['applyEdit', 'applyEdits'].includes(message?.type)
    if (
      negative === 'stale-minimap-view' &&
      !droppedMinimapEdit &&
      liveMinimaps()[1] === proof &&
      minimapPatch
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
        instance: globalThis.__inputWorkerProof.length,
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
        protocol: null,
        viewId: null,
        sourceAcknowledged: false,
        renderSourceMatched: false,
        acceptedSourceMatched: false,
        pendingSourceRequests: 0,
        pendingWorkerRequests: 0,
        pendingRenderRequests: 0,
        failedResponses: 0,
        canceledRenders: 0,
        staleResponses: 0,
        sourceReceipt: null,
        requestedRenderSource: null,
        acceptedRenderSource: null,
        attestedRenderedSource: null,
      }
      for (const name of [
        'requests',
        'sourceRequests',
        'documents',
        'reads',
        'projectRequests',
        'renderRequests',
      ])
        Object.defineProperty(this.proof, name, { value: new Map(), enumerable: false })
      Object.defineProperty(this.proof, 'minimapLog', { value: [], enumerable: false })
      Object.defineProperty(this.proof, 'minimapSource', {
        value: null,
        writable: true,
        enumerable: false,
      })
      Object.defineProperty(this.proof, 'renderSource', {
        value: null,
        writable: true,
        enumerable: false,
      })
      globalThis.__inputWorkerProof.push(this.proof)
      this.addEventListener('message', ({ data }) => {
        observeResponse(this.proof, data)
        observeMinimapResponse(this.proof, data)
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
      for (const [key, session] of globalThis.__inputWorkerSources)
        if (session.worker === this.proof) releaseSession(this.proof, key, session)
      for (const source of this.proof.documents.values()) source.log.length = 0
      for (const name of [
        'requests',
        'sourceRequests',
        'documents',
        'reads',
        'projectRequests',
        'renderRequests',
      ])
        this.proof[name].clear()
      this.proof.pendingSourceRequests = 0
      this.proof.pendingWorkerRequests = 0
      this.proof.pendingRenderRequests = 0
      this.proof.sourceReceipt = null
      this.proof.requestedRenderSource = null
      this.proof.acceptedRenderSource = null
      this.proof.attestedRenderedSource = null
      this.proof.minimapLog.length = 0
      this.proof.minimapSource = null
      this.proof.renderSource = null
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
  let point = null
  for (const entry of log) {
    const message = entry.message ?? entry
    if (message.type === 'projectSource') {
      if (
        !validSourceReceipt(message, entry.receipt) ||
        !pointsEqual(message.base, entry.expectedBase)
      )
        return null
      if (message.projection.kind === 'patch' && !pointsEqual(message.base, point)) return null
      const summary = message.projection.summary
      if (message.projection.kind === 'reset') lines = [...summary.lines]
      else {
        if (lines === null) return null
        lines.splice(summary.startLine, summary.deleteCount, ...summary.lines)
      }
      textLength = summary.textLength
      point = message.target
      continue
    }
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

export function replayCanonicalSource(canonical) {
  if (!canonical?.loan || !referencesEqual(canonical.reference, canonical.loan.reference))
    return null
  const source = canonical.loan.source
  if (
    source.owner?.acknowledged &&
    !pointsEqual(source.owner.acknowledged, canonical.reference.point)
  )
    return null
  let text = null
  let point = null
  for (const entry of source.log) {
    const { command, receipt } = entry
    if (command.kind === 'importRead') {
      if (
        receipt?.kind !== 'pinned' ||
        !referencesEqual(receipt.reference, {
          identity: command.identity,
          point: command.point,
          readId: command.readId,
        })
      )
        return null
      text = command.chunks.join('')
      point = command.point
      continue
    }
    if (!validSourceReceipt(command, receipt) || !pointsEqual(command.base, entry.expectedBase))
      return null
    if (command.kind === 'reset') text = command.chunks.join('')
    if (command.kind === 'advance') {
      if (text === null || !pointsEqual(command.base, point)) return null
      text = applyCanonicalEdits(text, command.edits)
      if (text === null) return null
    }
    point = command.target
  }
  if (
    !pointsEqual(point, canonical.reference.point) ||
    !identitiesEqual(source.identity, canonical.reference.identity)
  )
    return null
  return text
}

export function canonicalSourcePoint(canonical) {
  return canonical?.loan && referencesEqual(canonical.reference, canonical.loan.reference)
    ? canonical.reference.point
    : null
}

export function canonicalSourceIdentity(canonical) {
  return canonical?.loan && referencesEqual(canonical.reference, canonical.loan.reference)
    ? canonical.reference.identity
    : null
}

// Associates observed wire labels with actual opaque buffer segments, outside captured input.
export function createInputSourceIdentity(initialPoint) {
  const segments = new WeakMap()
  const wireSegments = new Set()
  let document = null
  return {
    matches(identity, source, point) {
      if (
        !identity ||
        !source ||
        source.revision !== point.revision ||
        source.textVersion !== point.textVersion
      )
        return false
      if (
        document &&
        (identity.documentId !== document.documentId ||
          identity.documentGeneration !== document.documentGeneration)
      )
        return false
      const known = segments.get(point.segment)
      if (known !== undefined) return known === source.segment
      if (wireSegments.has(source.segment)) return false
      if (!document && point.segment !== initialPoint.segment) return false
      document ??= {
        documentId: identity.documentId,
        documentGeneration: identity.documentGeneration,
      }
      segments.set(point.segment, source.segment)
      wireSegments.add(source.segment)
      return true
    },
  }
}

function applyCanonicalEdits(text, edits) {
  const ordered = [...edits].sort((left, right) => right.from - left.from || right.to - left.to)
  let boundary = text.length
  for (const edit of ordered) {
    if (
      !Number.isSafeInteger(edit.from) ||
      !Number.isSafeInteger(edit.to) ||
      edit.from < 0 ||
      edit.from > edit.to ||
      edit.to > boundary ||
      typeof edit.text !== 'string'
    )
      return null
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
    boundary = edit.from
  }
  return text
}

function pointsEqual(left, right) {
  if (left == null || right == null) return left === right
  return (
    left.segment === right.segment &&
    left.revision === right.revision &&
    left.textVersion === right.textVersion
  )
}
function identitiesEqual(left, right) {
  return Boolean(
    left &&
    right &&
    left.documentId === right.documentId &&
    left.documentGeneration === right.documentGeneration &&
    left.endpointGeneration === right.endpointGeneration &&
    left.registrationId === right.registrationId,
  )
}
function referencesEqual(left, right) {
  return Boolean(
    left &&
    right &&
    left.readId === right.readId &&
    identitiesEqual(left.identity, right.identity) &&
    pointsEqual(left.point, right.point),
  )
}
function validSourceReceipt(command, receipt) {
  return Boolean(
    receipt?.kind === 'applied' &&
    identitiesEqual(command.identity, receipt.identity) &&
    pointsEqual(command.base, receipt.base) &&
    pointsEqual(command.target, receipt.target),
  )
}
export function minimapProofState(worker, workers, visible) {
  const canonical =
    worker.protocol === 'canonical' ||
    workers.some((peer) => peer.url === worker.url && peer.protocol === 'canonical')
  const renderedAfterSource =
    worker.renderAfterSource === worker.sourceUpdates &&
    worker.latestRender > 0 &&
    worker.acceptedRender === worker.latestRender &&
    (!canonical ||
      (worker.sourceAcknowledged &&
        worker.renderSourceMatched &&
        worker.acceptedSourceMatched &&
        worker.pendingSourceRequests === 0 &&
        worker.pendingRenderRequests === 0 &&
        validProjectionReceipt(worker.sourceReceipt) &&
        receiptsEqual(worker.sourceReceipt, worker.requestedRenderSource) &&
        receiptsEqual(worker.sourceReceipt, worker.acceptedRenderSource)))
  const dormant =
    canonical &&
    visible === false &&
    typeof worker.viewId === 'string' &&
    worker.pendingSourceRequests === 0 &&
    worker.pendingRenderRequests === 0 &&
    worker.failedResponses === 0 &&
    worker.staleResponses === 0 &&
    ((worker.sourceUpdates === 0 && worker.latestRender === 0) ||
      (renderedAfterSource && settledMinimapSource(worker)))
  return { protocol: canonical ? 'canonical' : 'legacy', dormant, renderedAfterSource }
}

function settledMinimapSource(worker) {
  const receipt = worker.sourceReceipt
  return (
    validProjectionReceipt(receipt) &&
    receiptsEqual(receipt, worker.requestedRenderSource) &&
    receiptsEqual(receipt, worker.acceptedRenderSource) &&
    receiptsEqual(receipt, worker.attestedRenderedSource)
  )
}

function validProjectionReceipt(receipt) {
  const identity = receipt?.identity
  return (
    receipt?.kind === 'applied' &&
    typeof identity?.documentId === 'string' &&
    identity.documentId.length > 0 &&
    ['documentGeneration', 'endpointGeneration', 'registrationId'].every(
      (key) => Number.isSafeInteger(identity[key]) && identity[key] > 0,
    ) &&
    validWirePoint(receipt.target) &&
    (receipt.base === null || validWirePoint(receipt.base))
  )
}

function validWirePoint(point) {
  return (
    typeof point?.segment === 'string' &&
    point.segment.length > 0 &&
    Number.isSafeInteger(point.revision) &&
    point.revision >= 0 &&
    Number.isSafeInteger(point.textVersion) &&
    point.textVersion >= 0
  )
}

function receiptsEqual(left, right) {
  return (
    validProjectionReceipt(left) &&
    validProjectionReceipt(right) &&
    identitiesEqual(left.identity, right.identity) &&
    pointsEqual(left.base, right.base) &&
    pointsEqual(left.target, right.target)
  )
}

export function attestMinimapCurrentSource(worker) {
  if (
    !validProjectionReceipt(worker.sourceReceipt) ||
    !receiptsEqual(worker.sourceReceipt, worker.requestedRenderSource) ||
    !receiptsEqual(worker.sourceReceipt, worker.acceptedRenderSource)
  )
    return
  worker.attestedRenderedSource = worker.sourceReceipt
}

export function minimapRenderAccepted(worker, workers, visible) {
  if (worker.terminated || !worker.minimap) return true
  const state = minimapProofState(worker, workers, visible)
  return state.dormant || state.renderedAfterSource
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
