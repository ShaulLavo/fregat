import * as v from 'valibot'
import {
  attachmentUploadTicketSchema,
  chatAttachmentSchema,
  healthDescriptorSchema,
} from '@workspace/contracts'
import { attachmentTextOptions } from '@/features/chat/utils/attachment-file'
import { serverEndpoint } from '@/lib/client'
import { directInProcessFetcher } from '../../../../test/client'
import { documentTab } from '@/lib/documents/utils/tabs'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { QueryClient } from '@tanstack/react-query'
import {
  previewViewMutationOptions,
  boundedPreviewPrefix,
  attachmentPreviewMutationOptions,
} from '@/lib/file-preview/utils/source'
import { runMutation } from '@/lib/mutations/run'
import {
  originForQueryClient,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'
import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { makeTestServer } from '../../../../test/server'
import { createRequestGate } from '../../../../test/factories/request-gate'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createEditorBufferSession, type TextReadSnapshot } from '@singapore-editor/core/document'
import { fetchFile, statPath } from '@/lib/file-server'
import {
  filesystemPath,
  fileDocumentKey,
  fileDocument,
  tabId,
} from '@/lib/documents/utils/identity'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { expect, test } from '../../../../test/fixtures'

test('short disk calibrates; a dirty live preview reads the actual buffer instead of its disk capture', async ({
  client,
  server,
}) => {
  await writeFile(join(server.root, 'preview.txt'), 'saved disk\n')
  const f = await createAddressTestRuntime(client)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  const file = await fetchFile(filesystemPath('preview.txt'), new AbortController().signal, client)
  const document = f.editor.documentStore.getState().ensureLiveEditorDocument(file)
  createEditorBufferSession(document.buffer).applyText('dirty ')
  const disk = await f.application
    .getSnapshot()
    .queryClient.query(previewQueryOptions(file.path, 64))
  expect(disk).toMatchObject({ kind: 'text', text: 'saved disk\n', coverage: { kind: 'complete' } })
  expect(() =>
    expect(disk).toMatchObject({ text: document.buffer.materializeFullText() }),
  ).toThrow()
  const lease = f.editor.documentStore.getState().acquireLivePreview({
    scope: { environmentId: f.environmentId, rootPath: root.path },
    key: document.key,
    maxBytes: 64,
    signal: new AbortController().signal,
  })
  expect(lease?.read()).toMatchObject({
    kind: 'live',
    buffer: document.buffer,
    revision: document.buffer.getRevision(),
    snapshot: document.buffer.getTextSnapshot(),
    text: document.buffer.materializeFullText(),
    dirty: true,
    complete: true,
  })
  lease?.release()
})

test('real live prefix preserves UTF8/surrogate coverage, independent pins and terminal incarnations', async ({
  client,
  server,
}) => {
  const f = await createAddressTestRuntime(client)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  const docs = f.editor.documentStore.getState()
  await writeFile(join(server.root, 'unicode.txt'), 'a😀' + 'z'.repeat(400))
  const file = await fetchFile(filesystemPath('unicode.txt'), new AbortController().signal, client)
  const document = docs.ensureLiveEditorDocument(file)
  const scope = f.editor.documentStore.getState().previewScope
  if (!scope) throw new RangeError('Actual root namespace required')
  const abort = new AbortController()
  const first = docs.acquireLivePreview({
    key: document.key,
    scope,
    maxBytes: 4,
    signal: abort.signal,
  })
  const second = docs.acquireLivePreview({
    key: document.key,
    scope,
    maxBytes: 5,
    signal: new AbortController().signal,
  })
  expect(first?.read()).toMatchObject({
    kind: 'live',
    text: 'a',
    range: { start: 0, end: 1 },
    utf8Bytes: 1,
    complete: false,
  })
  expect(second?.read()).toMatchObject({
    kind: 'live',
    text: 'a😀',
    range: { start: 0, end: 3 },
    utf8Bytes: 5,
    complete: false,
  })
  expect(f.editor.documentStore.getState().previewSources.size).toBe(2)
  expect(docs.unevictableEditorDocumentKeys().has(document.key)).toBe(true)
  abort.abort()
  expect(first?.read().kind).toBe('released')
  expect(second?.read().kind).toBe('live')
  expect(docs.unevictableEditorDocumentKeys().has(document.key)).toBe(true)
  const editing = createEditorBufferSession(document.buffer)
  editing.applyText('!')
  const moved = second?.read()
  if (moved?.kind !== 'live') throw new RangeError('Actual moving live read required')
  expect(moved.buffer).toBe(document.buffer)
  expect(moved.snapshot).toBe(document.buffer.getTextSnapshot())
  expect(moved.revision).toBe(document.buffer.getRevision())
  expect(moved.dirty).toBe(true)
  editing.undo()
  expect(document.buffer.materializeFullText()).toBe(file.content)
  docs.forceReplaceLiveEditorDocument(file)
  expect(docs.getLiveEditorDocument(document.key)?.buffer).toBe(document.buffer)
  expect(second?.read().kind).toBe('live')
  docs.deleteLiveEditorDocument(document.key)
  const recreated = docs.ensureLiveEditorDocument(file)
  expect(recreated.buffer.materializeFullText()).toBe(document.buffer.materializeFullText())
  expect(recreated.buffer).not.toBe(document.buffer)
  expect(second?.read()).toEqual({ kind: 'unavailable', reason: 'live-ended' })
  expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
  const fresh = docs.acquireLivePreview({
    key: document.key,
    scope,
    maxBytes: 5,
    signal: new AbortController().signal,
  })
  expect(fresh?.read().kind).toBe('live')
  second?.release()
  expect(fresh?.read().kind).toBe('live')
  docs.disposeEditorDocuments()
  expect(fresh?.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
})

test('matched view acquisition has zero preview head/full reads; foreign and rootless remain immutable query-owned', async ({
  client,
  server,
}) => {
  const f = await createAddressTestRuntime(client)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  await writeFile(join(server.root, 'owned.txt'), 'disk owner\n')
  const file = await fetchFile(filesystemPath('owned.txt'), new AbortController().signal, client)
  const document = f.editor.documentStore.getState().ensureLiveEditorDocument(file)
  createEditorBufferSession(document.buffer).applyText('live edit')
  const queries = f.application.getSnapshot().queryClient
  let previewReads = 0
  registerEnvironmentQueryClient(
    queries,
    originForQueryClient(queries),
    createObservedInProcessClient(server, (request) => {
      if (['/fs/head', '/fs/read'].includes(new URL(request.url).pathname)) previewReads += 1
    }),
  )
  const shown = await runMutation(
    queries,
    previewViewMutationOptions(f.editor.previewSource, queries),
    {
      path: file.path,
      maxBytes: 64,
      scope: f.editor.documentStore.getState().previewScope,
      signal: new AbortController().signal,
    },
  )
  expect(shown.read.kind).toBe('live')
  expect(previewReads).toBe(0)
  expect(shown.lease).not.toBeNull()
  shown.lease?.release()
  const foreignServer = await makeTestServer()
  const foreign = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  registerEnvironmentQueryClient(
    foreign,
    'http://foreign-preview.invalid',
    createInProcessClient(foreignServer),
  )
  try {
    await writeFile(join(foreignServer.root, 'owned.txt'), 'foreign disk\n')
    const fallback = await runMutation(
      foreign,
      previewViewMutationOptions(f.editor.previewSource, foreign),
      { path: file.path, maxBytes: 64, scope: null, signal: new AbortController().signal },
    )
    expect(fallback.lease).toBeNull()
    expect(fallback.read.kind).toBe('disk')
    if (fallback.read.kind !== 'disk') throw new RangeError('Actual foreign capture required')
    expect(fallback.read.input.reader.materializeFullText()).toBe('foreign disk\n')
    expect(fallback.read.input.origin).toBe('http://foreign-preview.invalid')
    expect(fallback.read.input).not.toHaveProperty('scope')
    expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
    f.editor.documentStore.getState().setPreviewScope(null, originForQueryClient(queries))
    const rootless = await runMutation(
      queries,
      previewViewMutationOptions(f.editor.previewSource, queries),
      { path: file.path, maxBytes: 64, scope: null, signal: new AbortController().signal },
    )
    expect(rootless.lease).toBeNull()
    expect(rootless.read.kind).toBe('disk')
    expect(previewReads).toBe(1)
    expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
  } finally {
    foreign.clear()
    await foreignServer.cleanup()
  }
})

test('canceling a pending view leaves its imperative query peer and admitted source survivor intact', async ({
  client,
  server,
}) => {
  const f = await createAddressTestRuntime(client)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  await writeFile(join(server.root, 'a.txt'), 'surviving A\n')
  await writeFile(join(server.root, 'b.txt'), 'delayed B\n')
  const docs = f.editor.documentStore.getState()
  const document = docs.ensureLiveEditorDocument(
    await fetchFile(filesystemPath('a.txt'), new AbortController().signal, client),
  )
  const scope = f.editor.documentStore.getState().previewScope
  if (!scope) throw new RangeError('Actual scope required')
  const survivor = docs.acquireLivePreview({
    scope,
    key: document.key,
    maxBytes: 64,
    signal: new AbortController().signal,
  })
  const gate = createRequestGate((request) => new URL(request.url).pathname === '/fs/head')
  const queries = f.application.getSnapshot().queryClient
  registerEnvironmentQueryClient(
    queries,
    originForQueryClient(queries),
    createObservedInProcessClient(server, gate.beforeRequest),
  )
  const abort = new AbortController()
  const pending = runMutation(
    queries,
    previewViewMutationOptions(f.editor.previewSource, queries),
    { path: filesystemPath('b.txt'), maxBytes: 64, scope, signal: abort.signal },
  )
  const rejected = expect(pending).rejects.toBeDefined()
  try {
    await gate.entered
    const peer = queries.query(previewQueryOptions('b.txt', 64))
    abort.abort()
    await rejected
    expect(survivor?.read().kind).toBe('live')
    expect(f.editor.documentStore.getState().previewSources.size).toBe(1)
    gate.release()
    expect(await peer).toMatchObject({ kind: 'text', text: 'delayed B\n' })
    expect(f.editor.documentStore.getState().previewSources.size).toBe(1)
  } finally {
    gate.release()
    survivor?.release()
  }
})

test('bounded range reads stop at one codepoint of lookahead and no whole traversal', async ({
  client,
  server,
}) => {
  await writeFile(join(server.root, 'range.txt'), 'a😀' + 'z'.repeat(400))
  const f = await createAddressTestRuntime(client)
  const document = f.editor.documentStore
    .getState()
    .ensureLiveEditorDocument(
      await fetchFile(filesystemPath('range.txt'), new AbortController().signal, client),
    )
  const snapshot = document.buffer.getTextSnapshot()
  const ranges: { start: number; end: number }[] = []
  let wholeTraversals = 0
  const observed: TextReadSnapshot = {
    length: snapshot.length,
    lineCount: snapshot.lineCount,
    lineStart: (index) => snapshot.lineStart(index),
    lineRange: (index) => snapshot.lineRange(index),
    lineAt: (offset) => snapshot.lineAt(offset),
    readRange: (start, end) => {
      ranges.push({ start, end })
      return snapshot.readRange(start, end)
    },
    forEachTextChunk: (visit) => {
      wholeTraversals += 1
      snapshot.forEachTextChunk(visit)
    },
  }
  expect(boundedPreviewPrefix(observed, 5)).toEqual({
    text: 'a😀',
    range: { start: 0, end: 3 },
    utf8Bytes: 5,
    complete: false,
  })
  expect(wholeTraversals).toBe(0)
  expect(Math.max(...ranges.map((range) => range.end))).toBe(4)
  expect(ranges.reduce((sum, range) => sum + range.end - range.start, 0)).toBe(4)
})

test('real alternate namespace refuses a live borrow and an old pending capture after root ABA', async ({
  client,
  server,
}) => {
  const f = await createAddressTestRuntime(client)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  const firstRoot = { ...root, workspaceAddress, name: 'Root', type: 'directory' as const }
  f.editor.workspaceStore.getState().switchWorkspace(firstRoot)
  await mkdir(join(server.root, 'alternate'))
  const alternate = await statPath(
    filesystemPath('alternate'),
    new AbortController().signal,
    client,
  )
  const alternateAddress = await registerTestWorkspaceAddress(client, alternate.path)
  const scope = f.editor.documentStore.getState().previewScope
  if (!scope) throw new RangeError('Actual source scope required')
  await writeFile(join(server.root, 'pending.txt'), 'captured disk\n')
  const file = await fetchFile(filesystemPath('pending.txt'), new AbortController().signal, client)
  const docs = f.editor.documentStore.getState()
  const document = docs.ensureLiveEditorDocument(file)
  expect(() =>
    docs.acquireLivePreview({
      key: document.key,
      scope: { environmentId: scope.environmentId, rootPath: alternate.path },
      maxBytes: 64,
      signal: new AbortController().signal,
    }),
  ).toThrow('different namespace')
  docs.deleteLiveEditorDocument(document.key)
  const gate = createRequestGate((request) => new URL(request.url).pathname === '/fs/head')
  const queries = f.application.getSnapshot().queryClient
  registerEnvironmentQueryClient(
    queries,
    originForQueryClient(queries),
    createObservedInProcessClient(server, gate.beforeRequest),
  )
  const pending = runMutation(
    queries,
    previewViewMutationOptions(f.editor.previewSource, queries),
    { path: file.path, scope, maxBytes: 64, signal: new AbortController().signal },
  )
  const refused = expect(pending).rejects.toThrow('namespace changed')
  try {
    await gate.entered
    f.editor.workspaceStore.getState().switchWorkspace({
      ...alternate,
      workspaceAddress: alternateAddress,
      name: 'Alternate',
      type: 'directory',
    })
    f.editor.workspaceStore.getState().switchWorkspace(firstRoot)
    expect(f.editor.documentStore.getState().previewScope).not.toBe(scope)
    expect(f.editor.documentStore.getState().previewScope).toEqual(scope)
    gate.release()
    await refused
    expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
    expect(docs.hasLiveEditorDocument(document.key)).toBe(false)
    expect(await queries.query(previewQueryOptions(file.path, 64))).toMatchObject({
      kind: 'text',
      text: 'captured disk\n',
    })
  } finally {
    gate.release()
  }
})

test('adopted partial capture remains readonly while explicit open uses the existing full acquisition', async ({
  client,
  server,
}) => {
  const f = await createAddressTestRuntime(client)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  const path = filesystemPath('open.txt')
  await writeFile(join(server.root, path), 'original whole document\n')
  const queries = f.application.getSnapshot().queryClient
  let heads = 0
  let fullReads = 0
  registerEnvironmentQueryClient(
    queries,
    originForQueryClient(queries),
    createObservedInProcessClient(server, (request) => {
      const route = new URL(request.url).pathname
      if (route === '/fs/head') heads += 1
      if (route === '/fs/read') fullReads += 1
    }),
  )
  const capture = await queries.query(previewQueryOptions(path, 5))
  if (capture.kind !== 'text') throw new RangeError('Actual captured head required')
  const binding = await runMutation(
    queries,
    previewViewMutationOptions(f.editor.previewSource, queries),
    {
      path,
      maxBytes: 5,
      scope: f.editor.documentStore.getState().previewScope,
      signal: new AbortController().signal,
    },
  )
  if (binding.read.kind !== 'disk') throw new RangeError('Actual disk source required')
  expect(binding.read.input.head).toBe(capture.read.input.head)
  expect(binding.read.input.reader).toBe(capture.read.input.reader)
  expect(binding.read.input.head.coverage.kind).toBe('partial')
  const key = fileDocumentKey(path)
  const docs = f.editor.documentStore.getState()
  expect(docs.hasLiveEditorDocument(key)).toBe(false)
  expect(f.editor.fileOpenIntentOwner.service.claimLive(path)).toBeNull()
  expect(f.editor.fileOpenIntentOwner.service.claimReadyClean(path)).toBeNull()
  expect(heads).toBe(1)
  expect(fullReads).toBe(0)
  await writeFile(join(server.root, path), 'new full text after captured preview\n')
  const id = tabId('preview-explicit-open')
  expect(f.editor.editorActivation.activate(documentTab(fileDocument({ path })), id)).toBe('miss')
  const full = await queries.query(fileSnapshotQueryOptions(path))
  const opened = docs.ensureEditorView(id, full)
  expect(opened.buffer.materializeFullText()).toBe('new full text after captured preview\n')
  expect(fullReads).toBe(1)
  expect(binding.read.input.reader.materializeFullText()).toBe(capture.text)
  binding.lease?.release()
  expect(docs.getLiveEditorDocument(key)?.buffer).toBe(opened.buffer)
})

test('common attachment interests retain real bytes and readers beside a dirty live survivor', async ({
  client,
  server,
  onTestFinished,
}) => {
  const f = await createAddressTestRuntime(client)
  const queries = f.application.getSnapshot().queryClient
  const origin = serverEndpoint(originForQueryClient(queries))
  const body = 'old😀'
  const posted = await client.attachments.uploads.post({
    name: 'capture.txt',
    mimeType: 'text/plain',
    sizeBytes: new TextEncoder().encode(body).byteLength,
    type: 'file',
  })
  const ticket = v.parse(attachmentUploadTicketSchema, posted.data)
  const fetcher = directInProcessFetcher(server)
  const uploaded = await fetcher(new URL(ticket.uploadPath, server.origin), { body, method: 'PUT' })
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  if (attachment.type !== 'file') return expect.fail('Authenticated file identity required')
  const subject = {
    attachment,
    environmentId: f.environmentId,
    origin,
    provenance: 'staged' as const,
  }
  const capture = await queries.query(attachmentTextOptions(subject, fetcher))
  if (capture.kind !== 'attachment') return expect.fail('Real text reader required')
  expect(capture.bytes).toEqual(new TextEncoder().encode(body))
  expect(capture.decoded.seemsBinary).toBe(false)
  expect(Object.keys(f.editor.documentStore.getState().liveDocumentsByKey)).toHaveLength(0)
  const adopt = attachmentPreviewMutationOptions(f.editor.previewSource, queries)
  const first = await runMutation(queries, adopt, {
    input: capture,
    expected: capture,
    signal: new AbortController().signal,
  })
  const secondAbort = new AbortController()
  const second = await runMutation(queries, adopt, {
    input: capture,
    expected: capture,
    signal: secondAbort.signal,
  })
  expect(first.lease).not.toBeNull()
  expect(second.lease).not.toBe(first.lease)
  expect(first.read.kind).toBe('attachment')
  if (first.read.kind !== 'attachment') return expect.fail('Adopted capture required')
  expect(first.read.input).toBe(capture)
  expect(first.read.input.bytes).toBe(capture.bytes)
  expect(first.read.input.reader).toBe(capture.reader)
  expect(first.read.input.decoded).toBe(capture.decoded)
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  expect(first.lease?.read()).toBe(first.read)
  await writeFile(join(server.root, 'survivor.txt'), 'saved')
  const saved = await fetchFile(
    filesystemPath('survivor.txt'),
    new AbortController().signal,
    client,
  )
  const docs = f.editor.documentStore.getState()
  const live = docs.ensureLiveEditorDocument(saved)
  const session = createEditorBufferSession(live.buffer)
  session.applyText(' dirty')
  const liveSnapshot = live.buffer.getSnapshot()
  const scope = docs.previewScope
  if (!scope) return expect.fail('Actual live namespace required')
  const survivor = docs.acquireLivePreview({
    key: live.key,
    scope,
    maxBytes: 64,
    signal: new AbortController().signal,
  })
  expect(survivor?.read()).toMatchObject({
    kind: 'live',
    buffer: live.buffer,
    text: 'saved dirty',
    dirty: true,
  })
  const foreign = new QueryClient()
  registerEnvironmentQueryClient(foreign, origin, client)
  onTestFinished(() => foreign.clear())
  const unrelated = await runMutation(
    foreign,
    attachmentPreviewMutationOptions(f.editor.previewSource, foreign),
    { input: capture, expected: capture, signal: new AbortController().signal },
  )
  expect(unrelated.lease).toBeNull()
  expect(unrelated.read).toEqual({ kind: 'attachment', input: capture })
  const absent = await runMutation(queries, attachmentPreviewMutationOptions(null, queries), {
    input: capture,
    expected: capture,
    signal: new AbortController().signal,
  })
  expect(absent.lease).toBeNull()
  const otherServer = await makeTestServer()
  onTestFinished(() => otherServer.cleanup())
  const otherClient = createInProcessClient(otherServer)
  const health = await otherClient.health.get()
  const descriptor = v.parse(healthDescriptorSchema, health.data)
  for (const bad of [
    { ...capture, environmentId: descriptor.environmentId },
    { ...capture, origin: otherServer.origin },
  ]) {
    expect(() =>
      docs.adoptPreviewCapture({ input: bad, signal: new AbortController().signal }),
    ).toThrow('different owner')
    const unowned = await runMutation(queries, adopt, {
      input: bad,
      expected: bad,
      signal: new AbortController().signal,
    })
    expect(unowned.lease).toBeNull()
  }
  const sent = await queries.query(
    attachmentTextOptions({ ...subject, provenance: 'sent' }, fetcher),
  )
  if (sent.kind !== 'attachment') return expect.fail('Actual alternate provenance required')
  await expect(
    runMutation(queries, adopt, {
      input: capture,
      expected: sent,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('different selection')
  const baseline = f.editor.documentStore.getState().previewSources.size
  const cancelled = new AbortController()
  const pending = runMutation(queries, adopt, {
    input: capture,
    expected: capture,
    signal: cancelled.signal,
  })
  cancelled.abort()
  await expect(pending).rejects.toThrow(/abort/i)
  expect(f.editor.documentStore.getState().previewSources.size).toBe(baseline)
  const reentrant = new AbortController()
  const stop = f.editor.documentStore.subscribe((state) => {
    if (state.previewSources.size > baseline) reentrant.abort()
  })
  const ended = await runMutation(queries, adopt, {
    input: capture,
    expected: capture,
    signal: reentrant.signal,
  })
  stop()
  expect(ended.read.kind).toBe('released')
  expect(f.editor.documentStore.getState().previewSources.size).toBe(baseline)
  const replaced = await fetcher(new URL(ticket.uploadPath, server.origin), {
    method: 'PUT',
    body: 'new😀',
  })
  expect(replaced.status).toBe(200)
  const fresh = await queries.query(attachmentTextOptions(subject, fetcher))
  if (fresh.kind !== 'attachment') return expect.fail('Fresh actual capture required')
  expect(fresh).not.toBe(capture)
  expect(fresh.url).toBe(capture.url)
  expect(fresh.attachment.id).toBe(capture.attachment.id)
  expect(fresh.reader.readRange(0, fresh.reader.length)).toBe('new😀')
  expect(capture.reader.readRange(0, capture.reader.length)).toBe(body)
  expect(capture.bytes).toEqual(new TextEncoder().encode(body))
  const newer = await runMutation(queries, adopt, {
    input: fresh,
    expected: fresh,
    signal: new AbortController().signal,
  })
  first.lease?.release()
  first.lease?.release()
  expect(second.lease?.read()).toBe(second.read)
  secondAbort.abort()
  expect(second.lease?.read().kind).toBe('released')
  expect(newer.lease?.read()).toBe(newer.read)
  newer.lease?.release()
  expect(f.editor.documentStore.getState().previewSources.size).toBe(1)
  expect(survivor?.read().kind).toBe('live')
  expect(live.buffer.getSnapshot()).toBe(liveSnapshot)
  expect(live.buffer.canUndo()).toBe(true)
  session.undo()
  expect(live.buffer.materializeFullText()).toBe('saved')
  expect(live.buffer.canRedo()).toBe(true)
  survivor?.release()
  expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
  const last = await runMutation(queries, adopt, {
    input: fresh,
    expected: fresh,
    signal: new AbortController().signal,
  })
  f.editor.dispose()
  expect(last.lease?.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
})
