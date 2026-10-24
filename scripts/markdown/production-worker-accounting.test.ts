import { expect, test } from 'vitest'

import {
  completeWorkerBootstrapTransfer,
  reconcileProductionNetworkRequests,
  reconcileWorkerRequestCopies,
  workerCpuReceipts,
  type ProductionNetworkRequest,
} from './production-cdp'
import { productionWorkerTraceConfig } from './production-worker-trace-config'

const worker = {
  targetId: 'worker',
  url: 'https://fixture.test/shiki.worker.js',
  attachedAtMs: 0,
  detachedAtMs: null,
}
const mapping = {
  name: 'TracingSessionIdForWorker',
  pid: 2,
  tid: 3,
  args: { data: { workerId: worker.targetId } },
}
const request: ProductionNetworkRequest = {
  id: worker.targetId,
  url: worker.url,
  type: 'Script',
  fromCache: false,
  transferredBytes: null,
  completionEncodedBytes: 162,
  dataReceivedBytes: 999999,
  transferScope: 'worker-bootstrap-completion',
  phase: 'measurement',
  kind: 'javascript',
  failure: null,
  target: 'worker',
  workerTargetId: worker.targetId,
  resolvedByWorkerRequestId: null,
}
function resource(name: string, ts: number, data: Record<string, unknown>) {
  return { name, ts, pid: 2, tid: 3, args: { data: { requestId: '2.79', ...data } } }
}
const response = resource('ResourceReceiveResponse', 10, {
  mimeType: 'text/javascript',
  encodedDataLength: 162,
  fromCache: false,
})
const chunks = [
  resource('ResourceReceivedData', 11, { encodedDataLength: 700000 }),
  resource('ResourceReceivedData', 12, { encodedDataLength: 94327 }),
]
const finish = resource('ResourceFinish', 13, {
  encodedDataLength: 162,
  decodedBodyLength: 999999,
  didFail: false,
})
const events = [mapping, response].concat(chunks, [finish])

test('bootstrap transfer uses encoded response and encoded transfer updates, independent of decoded body', () => {
  expect(completeWorkerBootstrapTransfer(events, [worker], request)).toMatchObject({
    transferredBytes: 794489,
    completionEncodedBytes: 162,
    dataReceivedBytes: 999999,
    transferScope: 'full-request',
    traceTransferReceipt: {
      requestId: '2.79',
      responseEncodedBytes: 162,
      receivedEncodedBytes: 794327,
    },
  })
})

test('completed page and worker receipts reconcile by target and request identity', () => {
  const workerCompleted: ProductionNetworkRequest = {
    ...request,
    transferredBytes: 794489,
    transferScope: 'full-request',
  }
  const pageCompleted: ProductionNetworkRequest = {
    ...request,
    target: 'page',
    workerTargetId: null,
    transferredBytes: 794489,
    completionEncodedBytes: 794489,
    transferScope: 'full-request',
  }
  const reconciled = reconcileWorkerRequestCopies(pageCompleted, workerCompleted)
  expect(reconciled?.page).toMatchObject({
    resolvedByWorkerRequestId: workerCompleted.id,
    transferredBytes: 794489,
  })
  for (const receipts of [
    [pageCompleted, workerCompleted],
    [workerCompleted, pageCompleted],
  ]) {
    const copies = reconcileProductionNetworkRequests(receipts)
    expect(copies.filter((copy) => copy.resolvedByWorkerRequestId === null)).toHaveLength(1)
    expect(copies.find((copy) => copy.target === 'worker')?.transferredBytes).toBe(794489)
  }
  expect(
    reconcileWorkerRequestCopies(pageCompleted, {
      ...workerCompleted,
      workerTargetId: 'unrelated',
    }),
  ).toBeNull()
  expect(
    reconcileWorkerRequestCopies(pageCompleted, { ...workerCompleted, id: 'other-request' }),
  ).toBeNull()
  expect(
    reconcileWorkerRequestCopies(pageCompleted, { ...workerCompleted, transferredBytes: 794490 }),
  ).toEqual(
    expect.objectContaining({
      page: expect.objectContaining({
        transferredBytes: null,
        transferReceiptError: 'Page and worker transfer receipts disagree.',
      }),
      worker: expect.objectContaining({
        transferredBytes: null,
        transferReceiptError: 'Page and worker transfer receipts disagree.',
      }),
    }),
  )
})

test('incomplete, failed, cached and ambiguous bootstrap traces remain unknown', () => {
  for (const incomplete of [
    [mapping, response, finish],
    [mapping, ...chunks, finish],
    [response, ...chunks, finish],
    events.concat([response]),
    events.concat([{ ...mapping, tid: 4 }]),
    events.filter((entry) => entry !== finish),
    [
      mapping,
      response,
      resource('ResourceReceivedData', 11, { decodedBodyLength: 999999 }),
      finish,
    ],
    [mapping, response, ...chunks, resource('ResourceFinish', 13, { didFail: true })],
  ])
    expect(completeWorkerBootstrapTransfer(incomplete, [worker], request)).toBeNull()
  expect(
    completeWorkerBootstrapTransfer(events, [worker], { ...request, fromCache: true }),
  ).toBeNull()
  expect(completeWorkerBootstrapTransfer(events, [{ ...worker, url: 'wrong' }], request)).toBeNull()
})

test('production trace config requests every-task thread clocks and flat legacy CDP JSON', () => {
  const config = decodeProto(Buffer.from(productionWorkerTraceConfig(), 'base64'))
  const source = decodeProto(decodeProto(bytesField(config, 2)).get(1)?.[0])
  const track = decodeProto(bytesField(source, 113))
  expect(track.get(8)).toEqual([1])
  expect(track.get(10)).toEqual([0])
  expect(Buffer.from(bytesField(track, 1)).toString()).toBe('*')
  expect(
    track.get(2)?.map((entry) => Buffer.from(typeof entry === 'number' ? [] : entry).toString()),
  ).toContain('toplevel')
  const chrome = decodeProto(bytesField(source, 101))
  expect(chrome.get(3)).toEqual([1])
  expect(Buffer.from(bytesField(chrome, 5)).toString()).toBe('traceEvents')
})

type ProtoFields = Map<number, (number | Uint8Array)[]>

function bytesField(fields: ProtoFields, key: number): Uint8Array {
  const value = fields.get(key)?.[0]
  expect(value).toBeInstanceOf(Uint8Array)
  return value instanceof Uint8Array ? value : new Uint8Array()
}

function decodeProto(input: number | Uint8Array | undefined): ProtoFields {
  expect(input).toBeInstanceOf(Uint8Array)
  if (!(input instanceof Uint8Array)) return new Map()
  let offset = 0
  const readVarint = () => {
    let value = 0
    let shift = 0
    while (offset < input.length) {
      const byte = input[offset++]
      value += (byte & 127) * 2 ** shift
      if (byte < 128) return value
      shift += 7
    }
    return value
  }
  const fields: ProtoFields = new Map()
  while (offset < input.length) {
    const tag = readVarint()
    const wire = tag % 8
    expect([0, 2]).toContain(wire)
    const length = wire === 2 ? readVarint() : 0
    const value = wire === 0 ? readVarint() : input.slice(offset, (offset += length))
    fields.set(Math.floor(tag / 8), (fields.get(Math.floor(tag / 8)) ?? []).concat([value]))
  }
  return fields
}

test('open post-stream tasks do not invalidate measured CPU, while in-stream missing clocks do', () => {
  const stream: unknown[] = [
    mapping,
    { name: 'markdown-stream-start', ts: 100, pid: 2, tid: 1 },
    { name: 'markdown-stream-end', ts: 200, pid: 2, tid: 1 },
    { name: 'RunTask', pid: 2, tid: 3, ph: 'X', ts: 110, dur: 70, tdur: 20 },
    { name: 'markdown-update-2-start', ts: 150 },
  ]
  const postStream = { name: 'RunTask', pid: 2, tid: 3, ph: 'B', ts: 201 }
  expect(workerCpuReceipts(stream.concat([postStream]), [worker])[0]).toMatchObject({
    cpuMs: 0.02,
    measurement: 'complete',
    incompleteTaskCount: 0,
    boundaryCrossingTaskCount: 0,
  })
  expect(workerCpuReceipts(stream.concat([{ ...postStream, ts: 190 }]), [worker])[0]).toMatchObject(
    {
      cpuMs: null,
      measurement: 'incomplete',
      incompleteTaskCount: 1,
    },
  )
})

test('worker CPU counts only disjoint outer RunTask spans', () => {
  const events = [
    mapping,
    { name: 'markdown-stream-start', ts: 100, pid: 2, tid: 1 },
    { name: 'markdown-stream-end', ts: 500, pid: 2, tid: 1 },
    { name: 'RunTask', pid: 2, tid: 3, ph: 'X', ts: 150, dur: 200, tts: 10, tdur: 100 },
    { name: 'RunTask', pid: 2, tid: 3, ph: 'X', ts: 200, dur: 50, tts: 30, tdur: 20 },
    { name: 'RunTask', pid: 2, tid: 3, ph: 'X', ts: 400, dur: 20, tts: 120, tdur: 10 },
  ]
  expect(workerCpuReceipts(events, [worker])[0]).toMatchObject({
    cpuMs: 0.11,
    coveredCpuMs: 0.11,
    taskCount: 3,
    nestedTaskCount: 1,
    incompleteTaskCount: 0,
    boundaryCrossingTaskCount: 0,
    measurement: 'complete',
  })
})

test.each([
  {
    engine: 'remark',
    base: 1206113482241,
    dur: 1885,
    tts: 124,
    tdur: 1842,
    children: [
      [1740, 12, 1824, 12],
      [1753, 43, 1837, 41],
      [1798, 22, 1879, 22],
      [1821, 2, 1902, 2],
      [1824, 5, 1905, 5],
      [1830, 36, 1911, 36],
      [1866, 8, 1947, 8],
      [1875, 6, 1957, 6],
    ],
  },
  {
    engine: 'tree-sitter',
    base: 1206116902517,
    dur: 2242,
    tts: 116,
    tdur: 2215,
    children: [
      [1986, 20, 2077, 18],
      [2009, 56, 2098, 56],
      [2067, 52, 2156, 52],
      [2121, 4, 2210, 4],
      [2127, 9, 2217, 9],
      [2138, 62, 2228, 62],
      [2202, 18, 2291, 18],
      [2221, 15, 2311, 15],
    ],
  },
])('saved $engine nested clocks count the inclusive outer task once', (shape) => {
  const parent = {
    name: 'RunTask',
    pid: 2,
    tid: 3,
    ph: 'X',
    ts: shape.base,
    dur: shape.dur,
    tts: shape.tts,
    tdur: shape.tdur,
  }
  const marks: unknown[] = [
    mapping,
    { name: 'markdown-stream-start', ts: shape.base - 1, pid: 2, tid: 1 },
    { name: 'markdown-stream-end', ts: shape.base + shape.dur + 1, pid: 2, tid: 1 },
  ]
  const children = shape.children.map(([offset, dur, tts, tdur]) => ({
    ...parent,
    ts: shape.base + offset,
    dur,
    tts,
    tdur,
  }))
  expect(workerCpuReceipts(marks.concat([parent], children), [worker])[0]).toMatchObject({
    cpuMs: shape.tdur / 1000,
    nestedTaskCount: 8,
    measurement: 'complete',
  })
  expect(
    workerCpuReceipts(marks.concat([{ ...parent, tdur: undefined }], children), [worker])[0],
  ).toMatchObject({ cpuMs: null, measurement: 'incomplete', incompleteTaskCount: 1 })
})

test('ambiguous worker-to-thread mappings fail closed', () => {
  expect(
    workerCpuReceipts(
      [
        mapping,
        { ...mapping, tid: 4 },
        { name: 'markdown-stream-start', ts: 100 },
        { name: 'markdown-stream-end', ts: 200 },
      ],
      [worker],
    )[0],
  ).toMatchObject({
    measurement: 'incomplete',
    threadId: null,
    pid: null,
    reason: 'Trace mapped the worker target to multiple dedicated threads.',
  })
})

test('worker CPU spanning a stream boundary remains unknown even with complete task clocks', () => {
  for (const ts of [95, 195]) {
    expect(
      workerCpuReceipts(
        [
          mapping,
          { name: 'markdown-stream-start', ts: 100, pid: 2, tid: 1 },
          { name: 'markdown-stream-end', ts: 200, pid: 2, tid: 1 },
          { name: 'RunTask', pid: 2, tid: 3, ph: 'X', ts, dur: 10, tdur: 5 },
        ],
        [worker],
      )[0],
    ).toMatchObject({
      cpuMs: null,
      measurement: 'incomplete',
      boundaryCrossingTaskCount: 1,
    })
  }
})
