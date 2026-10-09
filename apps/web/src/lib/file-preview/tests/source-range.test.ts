import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { fetchFile, statPath } from '@/lib/file-server'
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
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { expect, test } from '../../../../test/fixtures'
import type { TestServer } from '../../../../test/server'
import type { createInProcessClient } from '../../../../test/client'

const TEXT = 'one needle two\n'
const NEEDLE = { start: 4, end: 10 }

async function liveSource(
  client: ReturnType<typeof createInProcessClient>,
  server: TestServer,
  name: string,
  maxBytes = 1024,
) {
  await writeFile(join(server.root, name), TEXT)
  const f = await createAddressTestRuntime(client)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  const docs = f.editor.documentStore.getState()
  const file = await fetchFile(filesystemPath(name), new AbortController().signal, client)
  const document = docs.ensureLiveEditorDocument(file)
  const scope = docs.previewScope
  if (!scope) throw new RangeError('Actual root namespace required')
  const acquire = (bytes = maxBytes) => {
    const lease = docs.acquireLivePreview({
      key: document.key,
      scope,
      maxBytes: bytes,
      signal: new AbortController().signal,
    })
    if (!lease) throw new RangeError('Actual live lease required')
    return lease
  }
  return { f, docs, file, document, acquire }
}

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

test('a captured range follows edits outside it and invalidates on edits inside it', async ({
  client,
  server,
}) => {
  const { document, acquire } = await liveSource(client, server, 'range-edits.txt')
  const lease = acquire()
  const captured = validRef(captureSourceRange(lease.read(), NEEDLE))
  expect(captured).toMatchObject({
    key: document.key,
    buffer: document.buffer,
    revision: document.buffer.getRevision(),
    range: NEEDLE,
  })
  expect(resolvedText(lease, captured)).toEqual({ range: NEEDLE, text: 'needle' })

  const editing = createEditorBufferSession(document.buffer)
  editing.applyEdits([{ from: 14, to: 14, text: ' three' }])
  expect(resolvedText(lease, captured)).toEqual({ range: NEEDLE, text: 'needle' })

  editing.applyEdits([{ from: 0, to: 3, text: 'first' }])
  expect(resolvedText(lease, captured)).toEqual({ range: { start: 6, end: 12 }, text: 'needle' })

  editing.applyEdits([{ from: 6, to: 6, text: '>' }])
  editing.applyEdits([{ from: 13, to: 13, text: '<' }])
  const shifted = resolvedText(lease, captured)
  expect(shifted).toEqual({ range: { start: 7, end: 13 }, text: 'needle' })

  const rebased = validRef(resolveSourceRange(captured, lease.read()))
  expect(rebased.revision).toBe(document.buffer.getRevision())
  editing.applyEdits([{ from: 9, to: 10, text: 'E' }])
  expect(resolveSourceRange(captured, lease.read())).toEqual({ kind: 'invalid', reason: 'edited' })
  expect(resolveSourceRange(rebased, lease.read())).toEqual({ kind: 'invalid', reason: 'edited' })
  lease.release()
})

test('an empty range survives a deletion after it and invalidates on one across it', async ({
  client,
  server,
}) => {
  const { document, acquire } = await liveSource(client, server, 'range-caret.txt')
  const lease = acquire()
  const caret = validRef(captureSourceRange(lease.read(), { start: 4, end: 4 }))
  const editing = createEditorBufferSession(document.buffer)
  editing.applyEdits([{ from: 4, to: 6, text: '' }])
  const rebased = validRef(resolveSourceRange(caret, lease.read()))
  expect(rebased.range).toEqual({ start: 4, end: 4 })
  editing.applyEdits([{ from: 2, to: 6, text: '' }])
  expect(resolveSourceRange(rebased, lease.read())).toEqual({ kind: 'invalid', reason: 'edited' })
  // The edit chain cannot compose a deletion across an earlier one, so the old point is unknown.
  expect(resolveSourceRange(caret, lease.read())).toEqual({
    kind: 'invalid',
    reason: 'history-unavailable',
  })
  lease.release()
})

test('a replaced buffer, closed file or released lease invalidates the range', async ({
  client,
  server,
}) => {
  const { docs, document, acquire } = await liveSource(client, server, 'range-life.txt')
  const replacedLease = acquire()
  const ref = validRef(captureSourceRange(replacedLease.read(), NEEDLE))
  await writeFile(join(server.root, 'range-life.txt'), 'changed on disk\n')
  const changed = await fetchFile(
    filesystemPath('range-life.txt'),
    new AbortController().signal,
    client,
  )
  docs.forceReplaceLiveEditorDocument(changed)
  const replacement = docs.getLiveEditorDocument(document.key)
  expect(replacement?.buffer).not.toBe(document.buffer)
  expect(resolveSourceRange(ref, replacedLease.read())).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
  const current = acquire()
  expect(resolveSourceRange(ref, current.read())).toEqual({ kind: 'invalid', reason: 'replaced' })

  const currentRef = validRef(captureSourceRange(current.read(), { start: 0, end: 7 }))
  const released = acquire()
  released.release()
  expect(resolveSourceRange(currentRef, released.read())).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
  expect(captureSourceRange(released.read(), { start: 0, end: 7 })).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
  docs.deleteLiveEditorDocument(document.key)
  expect(resolveSourceRange(currentRef, current.read())).toEqual({
    kind: 'invalid',
    reason: 'ended',
  })
})

test('partial and immutable preview sources yield no authoritative range', async ({
  client,
  server,
}) => {
  const { f, acquire } = await liveSource(client, server, 'range-partial.txt')
  const bounded = acquire(6)
  expect(bounded.read()).toMatchObject({ kind: 'live', complete: false, range: { end: 6 } })
  expect(captureSourceRange(bounded.read(), NEEDLE)).toEqual({ kind: 'invalid', reason: 'partial' })
  expect(captureSourceRange(bounded.read(), { start: 0, end: 3 }).kind).toBe('valid')
  expect(() => captureSourceRange(bounded.read(), { start: 10, end: 99 })).toThrow()

  await writeFile(join(server.root, 'range-disk.txt'), TEXT)
  const queries = f.application.getSnapshot().queryClient
  const view = (maxBytes: number) =>
    runMutation(queries, previewViewMutationOptions(f.editor.previewSource, queries), {
      path: filesystemPath('range-disk.txt'),
      maxBytes,
      scope: f.editor.documentStore.getState().previewScope,
      signal: new AbortController().signal,
    })
  const truncated = await view(6)
  expect(truncated.read).toMatchObject({ kind: 'disk', input: { head: { truncated: true } } })
  expect(captureSourceRange(truncated.read, { start: 0, end: 3 })).toEqual({
    kind: 'invalid',
    reason: 'partial',
  })
  const whole = await view(1024)
  expect(whole.read).toMatchObject({ kind: 'disk', input: { head: { truncated: false } } })
  expect(captureSourceRange(whole.read, NEEDLE)).toEqual({ kind: 'invalid', reason: 'not-live' })
  truncated.lease?.release()
  whole.lease?.release()
})

test('a range older than the retained edit chain reports history-unavailable; a rebased one stays valid', async ({
  client,
  server,
}) => {
  const { document, acquire } = await liveSource(client, server, 'range-history.txt')
  const lease = acquire()
  const stale = validRef(captureSourceRange(lease.read(), NEEDLE))
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
