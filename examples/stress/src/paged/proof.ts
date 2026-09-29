import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import { PagedDocument, PAGED_PROOF_OPTIONS, type RangeSource } from '@singapore-editor/paged'
import { PagedViewport } from './view'

const TILE = 'row🙂 e\u0301 中 payload\r\n'
const tile = new TextEncoder().encode(TILE)
let documentSource: PagedDocument | null = null
let viewport: PagedViewport | null = null
let revision = 'one'
let delayMs = 0
let resident: ReturnType<typeof createEditorTextBuffer> | null = null

function source(size: number): RangeSource {
  return {
    id: 'generated-utf8',
    revision,
    byteLength: size,
    async readBytes(start, end, signal) {
      // @justification Simulated source latency for the paged proof; it only resolves the awaited
      // read, and the abort signal is checked right after.
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      signal.throwIfAborted()
      const bytes = new Uint8Array(end - start)
      for (let at = 0; at < bytes.length; at++) bytes[at] = tile[(start + at) % tile.length]!
      return { revision, bytes }
    },
  }
}

async function open(size: number) {
  dispose()
  revision = 'one'
  const bytes = Math.floor(size / tile.length) * tile.length
  const doc = new PagedDocument(source(bytes))
  documentSource = doc
  const host = document.querySelector<HTMLElement>('#view')!
  viewport = new PagedViewport(host, doc)
  const start = performance.now()
  const indexing = doc.initialize()
  await viewport.show(0)
  const firstRangeMs = performance.now() - start
  await indexing
  return {
    bytes,
    firstRangeMs,
    indexedMs: performance.now() - start,
    tile: TILE,
    tileBytes: tile.length,
    stats: doc.stats,
  }
}

async function compare(mode: 'resident' | 'streamed', size: number) {
  dispose()
  revision = 'one'
  const bytes = Math.floor(size / tile.length) * tile.length
  const data = source(bytes)
  const start = performance.now()
  if (mode === 'resident') {
    const response = await data.readBytes(0, bytes, new AbortController().signal)
    resident = createEditorTextBuffer(new TextDecoder().decode(response.bytes))
    return { bytes, units: resident.getSnapshot().length, buildMs: performance.now() - start }
  }
  resident = createEditorTextBuffer('')
  const session = createEditorBufferSession(resident)
  const decoder = new TextDecoder()
  let pendingCR = ''
  for (let offset = 0; offset < bytes; offset += PAGED_PROOF_OPTIONS.pageBytes) {
    const part = await data.readBytes(
      offset,
      Math.min(bytes, offset + PAGED_PROOF_OPTIONS.pageBytes),
      new AbortController().signal,
    )
    const text = pendingCR + decoder.decode(part.bytes, { stream: true })
    pendingCR = text.endsWith('\r') ? '\r' : ''
    const complete = pendingCR ? text.slice(0, -1) : text
    session.applyEdits(
      [{ from: resident.getSnapshot().length, to: resident.getSnapshot().length, text: complete }],
      { history: 'skip' },
    )
  }
  const tail = pendingCR + decoder.decode()
  if (tail)
    session.applyEdits(
      [{ from: resident.getSnapshot().length, to: resident.getSnapshot().length, text: tail }],
      { history: 'skip' },
    )
  return { bytes, units: resident.getSnapshot().length, buildMs: performance.now() - start }
}

function dispose() {
  viewport?.dispose()
  documentSource?.dispose()
  viewport = null
  documentSource = null
  resident = null
}

const proof = {
  open,
  compare,
  dispose,
  sweep: async () => {
    const doc = documentSource!
    const view = doc.createView()
    try {
      const step = Math.max(1, Math.floor(PAGED_PROOF_OPTIONS.pageBytes / tile.length))
      for (let line = 0; line < doc.stats.lines - 1; line += step) {
        const window = await view.readLines(line, 1)
        if (window.rows[0]?.text !== TILE.slice(0, -1))
          throw new Error('Sweep differs from the source')
      }
      return doc.stats
    } finally {
      view.dispose()
    }
  },
  stats: () => documentSource?.stats,
  show: (line: number) => viewport!.show(line),
  setDelay: (delay: number) => {
    delayMs = delay
  },
  changeRevision: () => {
    revision = 'two'
  },
  copy: async (start: number, end: number) => {
    const view = documentSource!.createView()
    try {
      return await view.copyRange(start, end)
    } finally {
      view.dispose()
    }
  },
}

declare global {
  var __paged: typeof proof
}
globalThis.__paged = proof
