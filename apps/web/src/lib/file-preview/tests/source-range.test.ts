import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createEditorBufferSession, type TextEdit } from '@singapore-editor/core/document'
import { fetchFile } from '@/lib/file-server'
import { materializeFileSnapshotText } from '@/lib/file-snapshot'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { runMutation } from '@/lib/mutations/run'
import {
  captureSourceRange,
  previewViewMutationOptions,
  resolveSourceRange,
  type PreviewSourceLease,
  type SourceRangeRef,
  type SourceRangeResolution,
} from '@/lib/file-preview/utils/source'
import { createLivePreviewSource } from '../../../../test/factories/live-preview-source'
import { expect, test } from '../../../../test/fixtures'

const TEXT = 'one needle two\n'
const NEEDLE = { start: 4, end: 10 }

function validRef(resolution: SourceRangeResolution): SourceRangeRef {
  if (resolution.kind !== 'valid')
    throw new RangeError(`Valid range required: ${resolution.reason}`)
  return resolution.ref
}

function resolvedText(lease: PreviewSourceLease, ref: SourceRangeRef) {
  const resolution = resolveSourceRange(ref, lease.read())
  if (resolution.kind !== 'valid') return resolution
  const read = lease.read()
  if (read.kind !== 'live') throw new RangeError('Live read required')
  const { start, end } = resolution.ref.range
  return { range: resolution.ref.range, text: read.snapshot.readRange(start, end) }
}

test('a captured range follows edits away from it and invalidates on edits touching it', async ({
  client,
  server,
}) => {
  const { document, acquire } = await createLivePreviewSource(client, server, {
    path: 'range-edits.txt',
    text: TEXT,
  })
  const lease = acquire()
  const captured = validRef(captureSourceRange(lease.read(), NEEDLE, 'needle'))
  expect(captured).toMatchObject({
    key: document.key,
    buffer: document.buffer,
    revision: document.buffer.getRevision(),
    range: NEEDLE,
  })
  expect(resolvedText(lease, captured)).toEqual({ range: NEEDLE, text: 'needle' })

  const editing = createEditorBufferSession(document.buffer)
  editing.applyEdits([{ from: 14, to: 14, text: ' three' }])
  editing.applyEdits([{ from: 0, to: 2, text: 'first' }])
  expect(resolvedText(lease, captured)).toEqual({ range: { start: 7, end: 13 }, text: 'needle' })

  const rebased = validRef(resolveSourceRange(captured, lease.read()))
  editing.applyEdits([{ from: 7, to: 7, text: '>' }])
  expect(resolveSourceRange(captured, lease.read())).toEqual({ kind: 'invalid', reason: 'edited' })
  expect(resolveSourceRange(rebased, lease.read())).toEqual({ kind: 'invalid', reason: 'edited' })
  lease.release()
})

test('capture owns its coordinates', async ({ client, server }) => {
  const { acquire } = await createLivePreviewSource(client, server, {
    path: 'range-owned.txt',
    text: TEXT,
  })
  const lease = acquire()
  const range = { start: 4, end: 10 }
  const ref = validRef(captureSourceRange(lease.read(), range, 'needle'))
  range.start = 0
  range.end = 3
  expect(ref.range).toEqual(NEEDLE)
  expect(resolvedText(lease, ref)).toEqual({ range: NEEDLE, text: 'needle' })
  lease.release()
})

test('offsets computed from other text are refused, whether disk text or an earlier revision', async ({
  client,
  server,
}) => {
  const { document, acquire } = await createLivePreviewSource(client, server, {
    path: 'range-dirty.txt',
    text: TEXT,
  })
  const editing = createEditorBufferSession(document.buffer)
  editing.applyEdits([{ from: 0, to: 0, text: 'x' }])
  expect(document.buffer.isDirty()).toBe(true)
  const disk = await fetchFile(
    filesystemPath('range-dirty.txt'),
    new AbortController().signal,
    client,
  )
  const diskStart = materializeFileSnapshotText(disk).indexOf('needle')
  const diskRange = { start: diskStart, end: diskStart + 'needle'.length }
  const lease = acquire()
  expect(captureSourceRange(lease.read(), diskRange, 'needle')).toEqual({
    kind: 'invalid',
    reason: 'stale',
  })

  const read = lease.read()
  if (read.kind !== 'live') throw new RangeError('Live read required')
  const liveStart = read.snapshot.readRange(0, read.snapshot.length).indexOf('needle')
  const liveRange = { start: liveStart, end: liveStart + 'needle'.length }
  expect(resolvedText(lease, validRef(captureSourceRange(read, liveRange, 'needle')))).toEqual({
    range: liveRange,
    text: 'needle',
  })

  editing.applyEdits([{ from: 0, to: 0, text: 'y' }])
  expect(captureSourceRange(lease.read(), liveRange, 'needle')).toEqual({
    kind: 'invalid',
    reason: 'stale',
  })
  lease.release()
})

const publications: readonly {
  readonly name: string
  readonly range: { readonly start: number; readonly end: number }
  readonly edits: readonly TextEdit[]
  readonly expected: SourceRangeResolution['kind']
}[] = [
  {
    name: 'edits on both sides with a gap',
    range: NEEDLE,
    edits: [
      { from: 0, to: 0, text: 'ab' },
      { from: 15, to: 15, text: '!' },
    ],
    expected: 'valid',
  },
  {
    name: 'an insertion beside the range then removed',
    range: NEEDLE,
    edits: [
      { from: 2, to: 2, text: 'x' },
      { from: 2, to: 3, text: '' },
    ],
    expected: 'valid',
  },
  {
    name: 'a delete then an insert before the range',
    range: NEEDLE,
    edits: [
      { from: 0, to: 3, text: '' },
      { from: 0, to: 0, text: 'zz' },
    ],
    expected: 'valid',
  },
  {
    name: 'an insertion inside the range then removed',
    range: NEEDLE,
    edits: [
      { from: 6, to: 6, text: 'x' },
      { from: 6, to: 7, text: '' },
    ],
    expected: 'invalid',
  },
  {
    name: 'adjacent deletions meeting at a caret',
    range: { start: 4, end: 4 },
    edits: [
      { from: 4, to: 6, text: '' },
      { from: 0, to: 4, text: '' },
    ],
    expected: 'invalid',
  },
  {
    name: 'an insertion at the range start',
    range: NEEDLE,
    edits: [{ from: 4, to: 4, text: '>' }],
    expected: 'invalid',
  },
  {
    name: 'an insertion at the range end',
    range: NEEDLE,
    edits: [{ from: 10, to: 10, text: '<' }],
    expected: 'invalid',
  },
]

for (const scenario of publications) {
  test(`one resolve across publications matches a resolve after each: ${scenario.name}`, async ({
    client,
    server,
  }) => {
    const outcomes: SourceRangeResolution[] = []
    for (const rebaseEachStep of [true, false]) {
      const { document, acquire } = await createLivePreviewSource(client, server, {
        path: `range-chain-${rebaseEachStep}.txt`,
        text: TEXT,
      })
      const lease = acquire()
      const expectedText = TEXT.slice(scenario.range.start, scenario.range.end)
      let current = captureSourceRange(lease.read(), scenario.range, expectedText)
      const editing = createEditorBufferSession(document.buffer)
      for (const edit of scenario.edits) {
        editing.applyEdits([edit])
        if (rebaseEachStep && current.kind === 'valid')
          current = resolveSourceRange(current.ref, lease.read())
      }
      if (current.kind === 'valid') current = resolveSourceRange(current.ref, lease.read())
      outcomes.push(current)
      lease.release()
    }
    const [stepwise, once] = outcomes
    expect(stepwise?.kind).toBe(scenario.expected)
    expect(once?.kind).toBe(scenario.expected)
    if (stepwise?.kind === 'valid' && once?.kind === 'valid')
      expect(once.ref.range).toEqual(stepwise.ref.range)
    if (stepwise?.kind === 'invalid') expect(once).toEqual(stepwise)
  })
}

test('a replaced buffer, closed file or released lease invalidates the range', async ({
  client,
  server,
}) => {
  const { docs, document, acquire } = await createLivePreviewSource(client, server, {
    path: 'range-life.txt',
    text: TEXT,
  })
  const replacedLease = acquire()
  const ref = validRef(captureSourceRange(replacedLease.read(), NEEDLE, 'needle'))
  await writeFile(join(server.root, 'range-life.txt'), 'changed on disk\n')
  const changed = await fetchFile(
    filesystemPath('range-life.txt'),
    new AbortController().signal,
    client,
  )
  docs.forceReplaceLiveEditorDocument(changed)
  expect(docs.getLiveEditorDocument(document.key)?.buffer).not.toBe(document.buffer)
  expect(resolveSourceRange(ref, replacedLease.read())).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
  const current = acquire()
  expect(resolveSourceRange(ref, current.read())).toEqual({ kind: 'invalid', reason: 'replaced' })

  const currentRef = validRef(captureSourceRange(current.read(), { start: 0, end: 7 }, 'changed'))
  const released = acquire()
  released.release()
  expect(resolveSourceRange(currentRef, released.read())).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
  expect(captureSourceRange(released.read(), { start: 0, end: 7 }, 'changed')).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
  docs.deleteLiveEditorDocument(document.key)
  expect(resolveSourceRange(currentRef, current.read())).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
})

test('a range outside the read coverage is partial at capture and at resolution', async ({
  client,
  server,
}) => {
  const { document, acquire } = await createLivePreviewSource(client, server, {
    path: 'range-bounded.txt',
    text: TEXT,
  })
  const prefix = acquire(6)
  expect(prefix.read()).toMatchObject({ kind: 'live', complete: false, range: { end: 6 } })
  expect(captureSourceRange(prefix.read(), NEEDLE, 'needle')).toEqual({
    kind: 'invalid',
    reason: 'partial',
  })
  expect(captureSourceRange(prefix.read(), { start: 0, end: 3 }, 'one').kind).toBe('valid')
  expect(() => captureSourceRange(prefix.read(), { start: 10, end: 99 }, '')).toThrow()

  const whole = acquire()
  const wholeRef = validRef(captureSourceRange(whole.read(), NEEDLE, 'needle'))
  expect(resolveSourceRange(wholeRef, prefix.read())).toEqual({
    kind: 'invalid',
    reason: 'partial',
  })

  const tight = acquire(10)
  const tightRef = validRef(captureSourceRange(tight.read(), NEEDLE, 'needle'))
  createEditorBufferSession(document.buffer).applyEdits([{ from: 0, to: 0, text: 'x' }])
  expect(tight.read()).toMatchObject({ range: { end: 10 } })
  expect(resolveSourceRange(tightRef, tight.read())).toEqual({
    kind: 'invalid',
    reason: 'partial',
  })
  expect(resolveSourceRange(wholeRef, whole.read())).toMatchObject({
    kind: 'valid',
    ref: { range: { start: 5, end: 11 } },
  })
  for (const lease of [prefix, whole, tight]) lease.release()
})

test('disk captures yield no authoritative range', async ({ client, server }) => {
  const { runtime } = await createLivePreviewSource(client, server, {
    path: 'range-open.txt',
    text: TEXT,
  })
  await writeFile(join(server.root, 'range-disk.txt'), TEXT)
  const queries = runtime.application.getSnapshot().queryClient
  const view = (maxBytes: number) =>
    runMutation(queries, previewViewMutationOptions(runtime.editor.previewSource, queries), {
      path: filesystemPath('range-disk.txt'),
      maxBytes,
      scope: runtime.editor.documentStore.getState().previewScope,
      signal: new AbortController().signal,
    })
  const truncated = await view(6)
  expect(truncated.read).toMatchObject({ kind: 'disk', input: { head: { truncated: true } } })
  expect(captureSourceRange(truncated.read, { start: 0, end: 3 }, 'one')).toEqual({
    kind: 'invalid',
    reason: 'partial',
  })
  const whole = await view(1024)
  expect(whole.read).toMatchObject({ kind: 'disk', input: { head: { truncated: false } } })
  expect(captureSourceRange(whole.read, NEEDLE, 'needle')).toEqual({
    kind: 'invalid',
    reason: 'not-live',
  })
  truncated.lease?.release()
  whole.lease?.release()
})

test('a range older than the retained edit chain reports history-unavailable; a rebased one stays valid', async ({
  client,
  server,
}) => {
  const { document, acquire } = await createLivePreviewSource(client, server, {
    path: 'range-history.txt',
    text: TEXT,
  })
  const lease = acquire()
  const stale = validRef(captureSourceRange(lease.read(), NEEDLE, 'needle'))
  let rebased = stale
  const editing = createEditorBufferSession(document.buffer)
  for (let index = 0; index < 140; index += 1) {
    editing.applyEdits([{ from: 0, to: 0, text: 'x' }])
    rebased = validRef(resolveSourceRange(rebased, lease.read()))
  }
  expect(resolveSourceRange(stale, lease.read())).toEqual({
    kind: 'invalid',
    reason: 'history-unavailable',
  })
  expect(resolvedText(lease, rebased)).toEqual({
    range: { start: 144, end: 150 },
    text: 'needle',
  })
  lease.release()
})
