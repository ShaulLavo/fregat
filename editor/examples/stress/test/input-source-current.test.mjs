import { expect, test } from 'vitest'
import { consumerSourcesCurrent } from '../input-source-current.mjs'
import { minimapProofState } from '../input-worker-proof.mjs'

function settledHidden() {
  const receipt = {
    kind: 'applied',
    identity: {
      documentId: 'observed',
      documentGeneration: 1,
      endpointGeneration: 1,
      registrationId: 1,
    },
    base: null,
    target: { segment: 'observed', revision: 1, textVersion: 1 },
  }
  const worker = {
    url: 'minimap',
    minimap: true,
    terminated: false,
    protocol: 'canonical',
    viewId: 'view-0',
    sourceUpdates: 1,
    latestRender: 1,
    acceptedRender: 1,
    renderAfterSource: 1,
    sourceAcknowledged: true,
    renderSourceMatched: true,
    acceptedSourceMatched: true,
    pendingSourceRequests: 0,
    pendingWorkerRequests: 0,
    pendingRenderRequests: 0,
    failedResponses: 0,
    staleResponses: 0,
    sourceReceipt: receipt,
    requestedRenderSource: receipt,
    acceptedRenderSource: receipt,
    attestedRenderedSource: receipt,
  }
  return {
    sessions: [],
    tree: { pendingRequests: 0 },
    shiki: { pendingRequests: 0 },
    views: [{ visible: false }],
    workers: [worker],
    minimaps: [{ ...minimapProofState(worker, [worker], false), viewId: 'view-0', current: false }],
  }
}

test('retained hidden source stays noncurrent while its fully attested idle tuple is admitted', () => {
  const readiness = settledHidden()
  expect(readiness.minimaps[0].current).toBe(false)
  expect(consumerSourcesCurrent(readiness)).toBe(true)
})

test.each(['pendingSourceRequests', 'pendingRenderRequests', 'failedResponses', 'staleResponses'])(
  'rejects hidden %s',
  (field) => {
    const readiness = settledHidden()
    readiness.workers[0][field] = 1
    expect(consumerSourcesCurrent(readiness)).toBe(false)
  },
)

test.each(['tree', 'shiki'])('rejects an in-flight %s RPC', (kind) => {
  const readiness = settledHidden()
  readiness[kind].pendingRequests = 1
  expect(consumerSourcesCurrent(readiness)).toBe(false)
})

test.each([
  'sourceReceipt',
  'requestedRenderSource',
  'acceptedRenderSource',
  'attestedRenderedSource',
])('requires the full %s identity and point', (field) => {
  const readiness = settledHidden()
  readiness.workers[0][field] = {
    ...readiness.workers[0][field],
    target: { segment: 'foreign', revision: 1, textVersion: 1 },
  }
  expect(consumerSourcesCurrent(readiness)).toBe(false)
})

test('rejects missing prior current-source attestation, a visible stale source and an unmapped view', () => {
  const readiness = settledHidden()
  readiness.workers[0].attestedRenderedSource = null
  expect(consumerSourcesCurrent(readiness)).toBe(false)
  const visible = settledHidden()
  visible.views[0].visible = true
  expect(consumerSourcesCurrent(visible)).toBe(false)
  const unmapped = settledHidden()
  unmapped.minimaps[0].viewId = 'view-1'
  expect(consumerSourcesCurrent(unmapped)).toBe(false)
})

test('legacy hidden receipts keep their source/render requirements', () => {
  const readiness = settledHidden()
  readiness.minimaps[0].protocol = 'legacy'
  expect(consumerSourcesCurrent(readiness)).toBe(false)
  readiness.minimaps[0].dormant = false
  readiness.minimaps[0].current = true
  expect(consumerSourcesCurrent(readiness)).toBe(true)
})

test('pending legacy exception never admits a visible stale canonical source', () => {
  const readiness = settledHidden()
  readiness.views[0].visible = true
  readiness.minimaps[0].dormant = false
  expect(consumerSourcesCurrent(readiness, true)).toBe(false)
})

test.each(['failedResponses', 'staleResponses'])(
  'rejects active %s even when source and render match',
  (field) => {
    const readiness = settledHidden()
    readiness.views[0].visible = true
    readiness.minimaps[0].dormant = false
    readiness.minimaps[0].current = true
    readiness.workers[0][field] = 1
    expect(consumerSourcesCurrent(readiness)).toBe(false)
  },
)
