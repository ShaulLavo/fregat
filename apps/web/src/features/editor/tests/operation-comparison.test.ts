import { fetchFile } from '@/lib/file-server'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '../../../../test/fixtures'
import {
  createWorkspaceTextChanges,
  textChangePreview,
} from '../../../../test/factories/workspace-text-changes'
import { filesystemPath } from '@/lib/documents/utils/identity'

test('actual prepared text preview publishes its retained comparison beside the derived file', async ({
  client,
  server,
}) => {
  await writeFile(join(server.root, 'first.ts'), 'export const before = 1\n')
  const { service, store } = createWorkspaceTextChanges(client)
  const pending = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace captured text',
      requireConfirmation: true,
      targets: [
        {
          source: await operation.readText(filesystemPath('first.ts')),
          edits: [{ from: 13, to: 19, text: 'after' }],
        },
      ],
    }),
  })
  const operationId = await textChangePreview(service)
  try {
    const row = service.getSnapshot().preview?.rows[0]
    expect(row).toMatchObject({ path: 'first.ts', targetKind: 'unopened' })
    expect(Object.keys(store.getState().liveDocumentsByKey)).toHaveLength(0)
    expect(row).toHaveProperty('comparison')
    expect(store.getState().snapshotComparisons.size).toBe(1)
  } finally {
    service.cancelPreview(operationId)
    await pending
  }
})

import { operationComparisonSubject } from '@/lib/snapshot-comparison'
import { createOperationComparisonFixture } from '../../../../test/factories/operation-comparison'
import {
  operationDiffAttachment,
  snapshotDiffAttachment,
  diffAttachmentReferences,
  diffAttachmentLines,
  diffAttachmentSubject,
} from '@/lib/diff-attachment'
import {
  createEditorBufferSession,
  createDocumentTextSnapshot,
} from '@singapore-editor/core/document'
import { readFile } from 'node:fs/promises'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { environmentIdSchema } from '@workspace/contracts'
import { parse } from 'valibot'

test('retains exact actual segment snapshots through independent views and last release', async ({
  client,
  server,
}) => {
  const fixture = await createOperationComparisonFixture(server.root, client)
  const { input, read, file, store, service, operationId } = fixture
  expect(input.old.snapshot).toBe(input.segment.snapshotBefore)
  expect(input.new.snapshot).toBe(input.segment.snapshotAfter)
  expect(input.segment.steps.some((step) => step.operationIndex === input.operationIndex)).toBe(
    true,
  )
  const attachment = operationDiffAttachment(read, file)
  expect(attachment).not.toBeNull()
  if (!attachment) throw new RangeError('Actual operation attachment required')
  expect(diffAttachmentReferences(attachment)).toEqual([
    input.segment,
    input.segment.snapshotBefore,
    input.segment.snapshotAfter,
    file,
  ])
  expect(diffAttachmentLines(attachment).old?.join('\n')).toContain('before')
  expect(diffAttachmentLines(attachment).new?.join('\n')).toContain('after')
  expect(snapshotDiffAttachment(read, file)).toBeNull()
  expect(operationDiffAttachment(read, { ...file })).toBeNull()
  const firstController = new AbortController()
  const first = store
    .getState()
    .acquireSnapshotComparison({ input, signal: firstController.signal })
  const second = store
    .getState()
    .acquireSnapshotComparison({ input, signal: new AbortController().signal })
  expect(first.read()).toBe(second.read())
  const cloned = store.getState().acquireSnapshotComparison({
    input: { ...input, segment: { ...input.segment } },
    signal: new AbortController().signal,
  })
  expect(cloned.read()).not.toBe(second.read())
  cloned.release()
  expect(store.getState().snapshotComparisons.size).toBe(3)
  const refresh = second.requestRefresh()
  const wrongOperation = { ...input, operationId: 'another-operation' }
  wrongOperation.subject = operationComparisonSubject(wrongOperation)
  expect(second.refresh(wrongOperation, refresh)).toBe(false)
  expect(
    second.refresh(
      { ...input, root: { ...input.root, generation: input.root.generation + 1 } },
      refresh,
    ),
  ).toBe(false)
  expect(second.refresh({ ...input, segment: { ...input.segment } }, refresh)).toBe(false)
  expect(second.refresh({ ...input, display: { ...file } }, refresh)).toBe(false)
  expect(
    second.refresh({ ...input, old: createDocumentTextSnapshot(input.new.snapshot) }, refresh),
  ).toBe(false)
  expect(second.refresh(input, refresh)).toBe(true)
  const wrongRoot = { ...input, scope: { ...input.scope, rootPath: filesystemPath('other') } }
  expect(() =>
    store
      .getState()
      .acquireSnapshotComparison({ input: wrongRoot, signal: new AbortController().signal }),
  ).toThrow()
  const foreign = new WorkspaceDocumentService(
    () => undefined,
    parse(environmentIdSchema, '22222222-2222-4222-8222-222222222222'),
  )
  expect(() =>
    foreign.acquireSnapshotComparison({ input, signal: new AbortController().signal }),
  ).toThrow()
  foreign.dispose()
  firstController.abort()
  expect(first.read()).toEqual({ kind: 'released', reason: 'interest-ended' })
  expect(second.read().kind).toBe('ready')
  service.cancelPreview(operationId)
  await fixture.pending
  expect(store.getState().snapshotComparisons.size).toBe(1)
  const late = second.requestRefresh()
  second.release()
  expect(store.getState().snapshotComparisons.size).toBe(0)
  expect(second.refresh(input, late)).toBe(false)
  expect(operationDiffAttachment(second.read(), file)).toBeNull()
  expect(fixture.document.buffer.materializeFullText()).toContain('before')
  fixture.document.buffer.undo()
  expect(fixture.document.buffer.materializeFullText()).toBe('export const before = 1\n')
})

test('stale dismissal ends display interest after edit then Undo without authorizing a write', async ({
  client,
  server,
}) => {
  const fixture = await createOperationComparisonFixture(server.root, client)
  const before = fixture.input.old.materializeFullText()
  createEditorBufferSession(fixture.document.buffer).applyText('later')
  fixture.document.buffer.undo()
  expect(fixture.document.buffer.materializeFullText()).toBe(before)
  fixture.service.confirmPreview(fixture.operationId)
  await expect(fixture.pending).resolves.toMatchObject({ status: 'failed' })
  expect(fixture.service.getSnapshot().phase).toBe('stale')
  expect(fixture.service.getSnapshot().preview?.rows[0]?.comparison).toBe(fixture.read)
  expect(fixture.store.getState().snapshotComparisons.size).toBe(1)
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('export const before = 1\n')
  fixture.service.dismissResult()
  expect(fixture.store.getState().snapshotComparisons.size).toBe(0)
})

test('completion and final disposal release source interests while receipts keep Undo', async ({
  client,
  server,
}) => {
  const fixture = await createOperationComparisonFixture(server.root, client)
  fixture.service.confirmPreview(fixture.operationId)
  await expect(fixture.pending).resolves.toEqual({ status: 'applied' })
  expect(fixture.store.getState().snapshotComparisons.size).toBe(0)
  expect(fixture.document.buffer.materializeFullText()).toContain('after')
  expect(await fixture.service.undo()).toBe(true)
  expect(fixture.document.buffer.materializeFullText()).toBe(
    fixture.input.old.materializeFullText(),
  )
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('export const before = 1\n')
  const view = fixture.store
    .getState()
    .acquireSnapshotComparison({ input: fixture.input, signal: new AbortController().signal })
  fixture.store.getState().disposeEditorDocuments()
  expect(view.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  const late = fixture.store
    .getState()
    .acquireSnapshotComparison({ input: fixture.input, signal: new AbortController().signal })
  expect(late.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(operationDiffAttachment(late.read(), fixture.file)).toBeNull()
  expect(diffAttachmentSubject(operationDiffAttachment(fixture.read, fixture.file)!).key).toContain(
    fixture.operationId,
  )
})

test('an immediate edit publishes the exact captured read during commit and releases it on completion', async ({
  server,
  client,
}) => {
  await writeFile(join(server.root, 'first.ts'), 'export const before = 1\n')
  const { service, store } = createWorkspaceTextChanges(client)
  const file = await fetchFile(filesystemPath('first.ts'), new AbortController().signal, client)
  const document = store.getState().ensureLiveEditorDocument(file)
  const commits: unknown[] = []
  const stop = service.subscribe(() => {
    if (service.getSnapshot().phase !== 'committing') return
    const row = service.getSnapshot().preview?.rows[0]
    const read = row?.comparison
    if (read?.kind !== 'ready' || read.input.kind !== 'operation') return
    commits.push({
      before: read.input.old.materializeFullText(),
      after: read.input.new.materializeFullText(),
      exactBefore: read.input.old.snapshot === read.input.segment.snapshotBefore,
      exactAfter: read.input.new.snapshot === read.input.segment.snapshotAfter,
      exactFile: row?.file === read.input.display,
      admitted: [...store.getState().snapshotComparisons.values()].includes(read),
    })
  })
  await expect(
    service.applyTextChange({
      source: 'search-replace',
      signal: new AbortController().signal,
      prepare: async (operation) => ({
        label: 'Immediate replacement',
        requireConfirmation: false,
        targets: [
          {
            source: await operation.readText(filesystemPath('first.ts')),
            edits: [{ from: 13, to: 19, text: 'after' }],
          },
        ],
      }),
    }),
  ).resolves.toEqual({ status: 'applied' })
  stop()
  expect(commits).toEqual([
    {
      before: 'export const before = 1\n',
      after: 'export const after = 1\n',
      exactBefore: true,
      exactAfter: true,
      exactFile: true,
      admitted: true,
    },
  ])
  expect(store.getState().snapshotComparisons.size).toBe(0)
  document.buffer.undo()
  expect(document.buffer.materializeFullText()).toBe('export const before = 1\n')
})
