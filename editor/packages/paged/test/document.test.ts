import { expect, test } from 'vitest'
import {
  PagedDocument,
  PagedSourceInvalidatedError,
  PAGED_PROOF_OPTIONS,
  type RangeSource,
} from '../src/document'

const small = {
  ...PAGED_PROOF_OPTIONS,
  pageBytes: 7,
  cacheBytes: 28,
  checkpointLimit: 4,
  checkpointStride: 8,
}

function memorySource(bytes: Uint8Array): RangeSource {
  return {
    id: 'test',
    revision: 'one',
    byteLength: bytes.length,
    async readBytes(start, end) {
      return { revision: 'one', bytes: bytes.slice(start, end) }
    },
  }
}

function textSource(text: string) {
  return memorySource(new TextEncoder().encode(text))
}

test('LF checkpoints preserve raw UTF-16 positions through BOM, split UTF-8 and CRLF', async () => {
  const text = '\ufeffalpha🙂\r\ne\u0301中\nlast\r\n'.repeat(20) + 'no final newline'
  const doc = new PagedDocument(textSource(text), small)
  const view = doc.createView()
  await doc.initialize()
  const reference = text.split('\n')
  let offset = 0
  for (let line = 0; line < reference.length; line++) {
    expect((await view.readLines(line, 1)).rows).toEqual([{ line, offset, text: reference[line] }])
    offset += reference[line]!.length + 1
  }
  expect(await view.copyRange(0, text.length)).toBe(text)
  expect(doc.stats.utf16Length).toBe(text.length)
  expect(doc.stats.lines).toBe(reference.length)
  expect(doc.stats.checkpoints).toBeLessThanOrEqual(4)
  expect(doc.stats.peakCachedBytes).toBeLessThanOrEqual(28)
  view.dispose()
  doc.dispose()
  expect(doc.stats.cachedBytes).toBe(0)
})

test('malformed UTF-8 matches the complete TextDecoder oracle', async () => {
  const bytes = new Uint8Array([
    0xef, 0xbb, 0xbf, 97, 0xe2, 0x82, 10, 0xff, 0xc3, 0xa9, 10, 0xf0, 0x9f,
  ])
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  const doc = new PagedDocument(memorySource(bytes), { ...small, pageBytes: 4 })
  const view = doc.createView()
  await doc.initialize()
  expect(await view.copyRange(0, text.length)).toBe(text)
  expect((await view.readLines(0, 4)).rows.map((row) => row.text)).toEqual(text.split('\n'))
  view.dispose()
  doc.dispose()
})

test('rejects UTF-16 with a capability error', async () => {
  const doc = new PagedDocument(memorySource(new Uint8Array([0xff, 0xfe, 97, 0])), small)
  await expect(doc.initialize()).rejects.toThrow('UTF-16 requires a resident editor')
  expect(doc.stats.state).toBe('failed')
  doc.dispose()
})

test('long lines return an explicit bounded truncation while distant lines remain readable', async () => {
  const doc = new PagedDocument(textSource('x'.repeat(1000) + '\nlast'), {
    ...small,
    maxWindowUnits: 16,
  })
  const view = doc.createView()
  const first = await view.readLines(0, 1)
  expect(first.truncated).toBe(true)
  expect(first.rows[0]?.text).toBe('x'.repeat(16))
  await doc.initialize()
  expect((await view.readLines(1, 1)).rows).toEqual([{ line: 1, offset: 1001, text: 'last' }])
  await expect(view.copyRange(0, 17)).rejects.toThrow('range limit')
  view.dispose()
  doc.dispose()
})

test('two viewers share the bounded cache across distant jumps', async () => {
  const text = Array.from({ length: 200 }, (_, line) => `line-${line}🙂`).join('\n')
  const doc = new PagedDocument(textSource(text), small)
  const a = doc.createView()
  const b = doc.createView()
  expect(() => doc.createView()).toThrow('view limit')
  await doc.initialize()
  for (let line = 0; line < 200; line += 7) {
    const [left, right] = await Promise.all([a.readLines(line, 1), b.readLines(199 - line, 1)])
    expect(left.rows[0]?.text).toBe(`line-${line}🙂`)
    expect(right.rows[0]?.text).toBe(`line-${199 - line}🙂`)
  }
  expect(doc.stats.peakInFlight).toBeLessThanOrEqual(2)
  expect(doc.stats.peakCachedBytes).toBeLessThanOrEqual(28)
  a.dispose()
  b.dispose()
  doc.dispose()
})

test('a replaced jump rejects stale replies even when the source ignores cancellation', async () => {
  const underlying = textSource('one\ntwo\nthree\nfour\n')
  let delayed = false
  let release = () => {}
  const source: RangeSource = {
    ...underlying,
    async readBytes(start, end, signal) {
      if (delayed)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      return underlying.readBytes(start, end, signal)
    },
  }
  const doc = new PagedDocument(source, { ...small, cacheBytes: 7 })
  const view = doc.createView()
  await doc.initialize()
  delayed = true
  const stale = view.readLines(0, 1)
  const rejected = expect(stale).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  await Promise.resolve()
  delayed = false
  const latest = view.readLines(3, 1)
  release()
  await rejected
  expect((await latest).rows[0]?.text).toBe('four')
  view.dispose()
  doc.dispose()
})

test('revision mismatch invalidates cached pages and every viewer', async () => {
  const underlying = textSource('one\ntwo\nthree\nfour\n')
  let revision = 'one'
  const source: RangeSource = {
    ...underlying,
    async readBytes(start, end, signal) {
      const result = await underlying.readBytes(start, end, signal)
      return { ...result, revision }
    },
  }
  const doc = new PagedDocument(source, small)
  const view = doc.createView()
  await doc.initialize()
  expect(doc.stats.cachedBytes).toBe(underlying.byteLength)
  revision = 'two'
  await expect(view.readLines(0, 1)).rejects.toThrow('file changed')
  expect(doc.stats.state).toBe('stale')
  expect(doc.stats.cachedBytes).toBe(0)
  await expect(view.readLines(3, 1)).rejects.toThrow('stale')
  view.dispose()
  doc.dispose()
})

test('source invalidation clears cached pages and prevents reads from every viewer', async () => {
  const underlying = textSource('one\ntwo\nthree\nfour\n')
  let invalid = false
  const source: RangeSource = {
    ...underlying,
    async readBytes(start, end, signal) {
      if (invalid) throw new PagedSourceInvalidatedError()
      return underlying.readBytes(start, end, signal)
    },
  }
  const doc = new PagedDocument(source, small)
  const first = doc.createView()
  const second = doc.createView()
  await doc.initialize()
  expect(doc.stats.cachedBytes).toBe(underlying.byteLength)
  invalid = true
  await expect(first.readLines(0, 1)).rejects.toMatchObject({ code: 'PAGED_DOCUMENT_STALE' })
  expect(doc.stats.state).toBe('stale')
  expect(doc.stats.cachedBytes).toBe(0)
  expect(doc.stats.checkpoints).toBe(0)
  await expect(second.readLines(3, 1)).rejects.toThrow('stale')
  first.dispose()
  second.dispose()
  doc.dispose()
})

test('late invalidation from an aborted source read leaves the document reusable', async () => {
  const underlying = textSource('one\ntwo\nthree\nfour\n')
  let delayed = false
  let release = () => {}
  const source: RangeSource = {
    ...underlying,
    async readBytes(start, end, signal) {
      if (!delayed) return underlying.readBytes(start, end, signal)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      throw new PagedSourceInvalidatedError()
    },
  }
  const doc = new PagedDocument(source, { ...small, cacheBytes: 7 })
  const view = doc.createView()
  await doc.initialize()
  delayed = true
  const controller = new AbortController()
  const pending = view.readLines(0, 1, controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()
  delayed = false
  release()
  await rejected
  expect(doc.stats.state).toBe('ready')
  expect((await view.readLines(0, 1)).rows[0]?.text).toBe('one')
  view.dispose()
  doc.dispose()
})

test('a late foreground page retained after indexing still detects a source change', async () => {
  const underlying = textSource('line\n'.repeat(32))
  let enterIndex!: () => void
  const indexEntered = new Promise<void>((resolve) => {
    enterIndex = resolve
  })
  let releaseIndex!: () => void
  const indexReleased = new Promise<void>((resolve) => {
    releaseIndex = resolve
  })
  let enterPage!: () => void
  const pageEntered = new Promise<void>((resolve) => {
    enterPage = resolve
  })
  let releasePage!: () => void
  const pageReleased = new Promise<void>((resolve) => {
    releasePage = resolve
  })
  let firstPageReads = 0
  let invalid = false
  const source: RangeSource = {
    ...underlying,
    async readBytes(start, end, signal) {
      if (invalid) throw new PagedSourceInvalidatedError()
      if (start === 0 && end > start) {
        firstPageReads++
        const entered = firstPageReads === 1 ? enterIndex : enterPage
        const released = firstPageReads === 1 ? indexReleased : pageReleased
        entered()
        await released
      }
      return underlying.readBytes(start, end, signal)
    },
  }
  const doc = new PagedDocument(source, small)
  const view = doc.createView()
  const indexing = doc.initialize()
  await indexEntered
  const foreground = view.readLines(0, 1)
  await pageEntered
  releaseIndex()
  await indexing
  releasePage()
  expect((await foreground).rows[0]?.text).toBe('line')
  expect(doc.stats.state).toBe('ready')
  invalid = true
  await expect(view.readLines(0, 1)).rejects.toMatchObject({ code: 'PAGED_DOCUMENT_STALE' })
  expect(doc.stats.cachedBytes).toBe(0)
  view.dispose()
  doc.dispose()
})

test('cached multi-page reads and copies validate once without transferring page bytes', async () => {
  const underlying = textSource('one\ntwo\nthree\nfour\n')
  const ranges: [number, number][] = []
  const source: RangeSource = {
    ...underlying,
    async readBytes(start, end, signal) {
      ranges.push([start, end])
      return underlying.readBytes(start, end, signal)
    },
  }
  const doc = new PagedDocument(source, small)
  const view = doc.createView()
  await doc.initialize()
  expect(doc.stats.cachedBytes).toBe(underlying.byteLength)
  const bytesRead = doc.stats.bytesRead
  ranges.length = 0
  expect((await view.readLines(0, 4)).rows.map((row) => row.text)).toEqual([
    'one',
    'two',
    'three',
    'four',
  ])
  expect(ranges).toEqual([[0, 0]])
  ranges.length = 0
  expect(await view.copyRange(0, 19)).toBe('one\ntwo\nthree\nfour\n')
  expect(ranges).toEqual([[0, 0]])
  expect(doc.stats.bytesRead).toBe(bytesRead)
  view.dispose()
  doc.dispose()
})

test('a malformed empty validation response rejects retained reads and copies', async () => {
  const underlying = textSource('one\ntwo\nthree\nfour\n')
  const source: RangeSource = {
    ...underlying,
    async readBytes(start, end, signal) {
      if (start === end) return { revision: underlying.revision, bytes: new Uint8Array(1) }
      return underlying.readBytes(start, end, signal)
    },
  }
  const doc = new PagedDocument(source, small)
  const view = doc.createView()
  await doc.initialize()
  await expect(view.readLines(0, 1)).rejects.toThrow('bytes for an empty range')
  await expect(view.copyRange(0, 3)).rejects.toThrow('bytes for an empty range')
  expect(doc.stats.inFlight).toBe(0)
  view.dispose()
  doc.dispose()
})

test.each(['stale', 'disposed'] as const)(
  'cached validations obey admission and cannot publish after the document becomes %s',
  async (state) => {
    const underlying = textSource('one\ntwo\nthree\nfour\n')
    let enter!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let validations = 0
    const source: RangeSource = {
      ...underlying,
      async readBytes(start, end, signal) {
        if (start !== end) return underlying.readBytes(start, end, signal)
        validations++
        if (validations === 2) enter()
        await released
        if (state === 'stale') throw new PagedSourceInvalidatedError()
        return underlying.readBytes(start, end, signal)
      },
    }
    const doc = new PagedDocument(source, { ...small, maxViews: 3 })
    const views = [doc.createView(), doc.createView(), doc.createView()]
    await doc.initialize()
    const settled = Promise.allSettled(views.map((view) => view.readLines(0, 1)))
    await entered
    expect(validations).toBe(2)
    expect(doc.stats.inFlight).toBe(2)
    if (state === 'disposed') doc.dispose()
    release()
    const results = await settled
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
    expect(validations).toBe(2)
    expect(doc.stats.state).toBe(state)
    expect(doc.stats.cachedBytes).toBe(0)
    expect(doc.stats.inFlight).toBe(0)
    expect(doc.stats.peakInFlight).toBe(2)
    for (const view of views) view.dispose()
    doc.dispose()
  },
)

test('query cancellation aborts a cached-page continuation and leaves the view reusable', async () => {
  const doc = new PagedDocument(textSource('first\nlast'), small)
  const view = doc.createView()
  await doc.initialize()
  const pending = view.readLines(0, 1)
  view.cancel()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect((await view.readLines(1, 1)).rows[0]?.text).toBe('last')
  view.dispose()
  doc.dispose()
})

test('late cancellation of an older query leaves the current query running', async () => {
  const doc = new PagedDocument(textSource('first\nlast'), small)
  const view = doc.createView()
  await doc.initialize()
  const a = new AbortController()
  const b = new AbortController()
  const previous = view.readLines(0, 1, a.signal)
  const rejected = expect(previous).rejects.toMatchObject({ name: 'AbortError' })
  const current = view.readLines(1, 1, b.signal)
  a.abort()
  await rejected
  expect((await current).rows[0]?.text).toBe('last')
  const cancelled = view.readLines(0, 1, b.signal)
  b.abort()
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  expect((await view.readLines(0, 1)).rows[0]?.text).toBe('first')
  view.dispose()
  doc.dispose()
})

test('copy cancellation is bound to its request, including an already aborted signal', async () => {
  const doc = new PagedDocument(textSource('first\nlast'), small)
  const view = doc.createView()
  await doc.initialize()
  const a = new AbortController()
  const previous = view.copyRange(0, 5, a.signal)
  const rejected = expect(previous).rejects.toMatchObject({ name: 'AbortError' })
  const current = view.copyRange(6, 10)
  a.abort()
  await rejected
  expect(await current).toBe('last')
  await expect(view.copyRange(0, 5, a.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(await view.copyRange(0, 5)).toBe('first')
  view.dispose()
  doc.dispose()
})
