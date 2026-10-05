import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { fetchFile } from '@/lib/file-server'
import {
  documentKey,
  fileDocumentKey,
  filesystemPath,
  settingsJsonDocument,
  tabId,
  workspaceRoot,
} from '@/lib/documents/utils/identity'
import type { DocumentKey, TabId } from '@/lib/documents/utils/types'
import type { EditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { createEditorBufferSession, type EditorTextBuffer } from '@singapore-editor/core/document'
import { expect, test } from '../../../../test/fixtures'
import { retentionProvider } from '../../../../test/factories/retention-provider'
import { createPlatformFileOpenPreparer } from '@/features/editor/utils/prepared-document'
import { preparationEnvironment } from '../../../../test/factories/file-preparation'

test('removes document membership before its provider disposal callback', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('released.ts')
  await writeFile(join(server.root, path), 'const saved = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const document = documents.ensureLiveDocument(file)
  const observed: (EditorTextBuffer | null)[] = []
  const lease = document.analysis.borrowStructural({
    languageId: 'typescript',
    provider: retentionProvider(() =>
      observed.push(documents.getLiveDocument(document.key)?.buffer ?? null),
    ),
  })
  expect(lease).not.toBeNull()
  await lease?.refresh(document.buffer.getTextSnapshot())
  documents.deleteLiveDocument(document.key)
  expect(observed).toEqual([null])
})

test('replaces document membership before the former provider disposal callback', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('replaced.ts')
  await writeFile(join(server.root, path), 'const original = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const document = documents.ensureLiveDocument(file)
  const observed: (EditorTextBuffer | null)[] = []
  const lease = document.analysis.borrowStructural({
    languageId: 'typescript',
    provider: retentionProvider(() =>
      observed.push(documents.getLiveDocument(document.key)?.buffer ?? null),
    ),
  })
  expect(lease).not.toBeNull()
  await lease?.refresh(document.buffer.getTextSnapshot())
  await writeFile(join(server.root, path), 'const replacement = true\n')
  const replacement = await fetchFile(path, new AbortController().signal, client)
  documents.forceReplaceLiveDocument(replacement)
  const current = documents.getLiveDocument(document.key)
  expect(current?.buffer === document.buffer).toBe(false)
  expect(observed).toHaveLength(1)
  expect(observed[0] === current?.buffer).toBe(true)
})

test.for(['ensure-member', 'force-member', 'ensure-provider', 'force-provider'] as const)(
  '$0 preserves canonical edits made during replacement callbacks',
  async (mode, { server, client, onTestFinished }) => {
    const path = filesystemPath('replacement-edit.ts')
    await writeFile(join(server.root, path), 'const before = true\n')
    const documents = new WorkspaceDocumentService()
    onTestFinished(() => documents.dispose())
    const before = documents.ensureLiveDocument(
      await fetchFile(path, new AbortController().signal, client),
    )
    const editCurrent = () => {
      const current = documents.getLiveDocument(before.key)
      if (!current || current.buffer === before.buffer) return
      createEditorBufferSession(current.buffer).applyText(' edited')
    }
    if (mode.endsWith('member')) documents.subscribeEditorAnalyses(editCurrent)
    if (mode.endsWith('provider')) {
      const lease = before.analysis.borrowStructural({
        languageId: 'typescript',
        provider: retentionProvider(editCurrent),
      })
      expect(lease).not.toBeNull()
      await lease?.refresh(before.buffer.getTextSnapshot())
    }
    const replacementText = 'const after = true\n'
    await writeFile(join(server.root, path), replacementText)
    const replacement = await fetchFile(path, new AbortController().signal, client)
    if (mode.startsWith('ensure')) documents.ensureLiveDocument(replacement)
    else documents.forceReplaceLiveDocument(replacement)

    const current = documents.getLiveDocument(before.key)!
    expect(current.buffer.materializeFullText()).toBe(`${replacementText} edited`)
    expect(current.buffer.isDirty()).toBe(true)
    expect(current.localRevision).toBe(current.buffer.getRevision())
    expect(documents.state().dirtyDocumentKeys.has(current.key)).toBe(true)
    expect(documents.state().documentContentRevisions[current.key]).toBe(current.contentRevision)
    expect(current.buffer.canUndo()).toBe(true)
    const source = documents.acquireFilePreparation({
      kind: 'captured-file-snapshot',
      file: replacement,
    })!
    expect(source.document).toBe(current)
    expect(source.document.analysis).toBe(current.analysis)
    expect(documents.isTargetStampCurrent(documents.prepareTargetStamp(current.key)!)).toBe(true)
    source.release()
  },
)

test.for(['settings', 'unsynced', 'reset'] as const)(
  '$0 initializes canonical bookkeeping before membership edits',
  (kind, { onTestFinished }) => {
    const documents = new WorkspaceDocumentService()
    onTestFinished(() => documents.dispose())
    const target =
      kind === 'unsynced'
        ? { kind: 'search' as const, root: workspaceRoot('repo') }
        : settingsJsonDocument('user')
    const key = documentKey(target)
    if (kind === 'reset')
      documents.ensureSettingsDocument(settingsJsonDocument('user'), {
        content: '{}',
        revision: 'before',
      })
    const stop = documents.subscribeEditorAnalyses(() => {
      const current = documents.getLiveDocument(key)
      if (current) createEditorBufferSession(current.buffer).applyText(' edited')
    })
    onTestFinished(stop)
    let ensured: ReturnType<typeof documents.ensureSettingsDocument> | undefined
    if (target.kind === 'search')
      ensured = documents.ensureUnsyncedDocument({ target, content: 'replacement' })
    if (target.kind === 'settings-json' && kind !== 'reset')
      ensured = documents.ensureSettingsDocument(target, {
        content: 'replacement',
        revision: 'after',
      })
    if (kind === 'reset')
      expect(documents.replaceUnsyncedDocumentText(key, 'replacement')).toBe(true)
    const current = documents.getLiveDocument(key)!
    if (ensured) expect(ensured).toBe(current)
    expect(current.buffer.materializeFullText()).toBe('replacement edited')
    expect(current.localRevision).toBe(current.buffer.getRevision())
    expect(documents.state().dirtyDocumentKeys.has(key)).toBe(true)
    expect(documents.state().documentContentRevisions[key]).toBe(current.contentRevision)
    expect(current.buffer.canUndo()).toBe(true)
    current.buffer.undo()
    expect(current.buffer.materializeFullText()).toBe('replacement')
  },
)

test('canonical acquisition reports membership deletion without reviving or pinning the record', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('deleted-on-admission.ts')
  await writeFile(join(server.root, path), 'const current = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const key = fileDocumentKey(path)
  const stop = documents.subscribeEditorAnalyses(() => {
    if (documents.getLiveDocument(key)) documents.deleteLiveDocument(key)
  })
  onTestFinished(stop)
  expect(() => documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })).toThrow(
    'Missing live document',
  )
  expect([...documents.enumerateEditorAnalyses()]).toEqual([])
  expect(documents.state().documentContentRevisions).toEqual({})
  expect(documents.state().dirtyDocumentKeys.size).toBe(0)
  stop()
  const source = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })!
  const keep = { documentKeys: new Set<DocumentKey>(), tabIds: new Set<TabId>() }
  expect(documents.retain(keep).evictedDocumentKeys).toEqual([])
  source.release()
  expect(documents.retain(keep).evictedDocumentKeys).toEqual([source.document.key])
})

test('document creation returns the canonical replacement installed by a membership callback', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('replaced-on-admission.ts')
  await writeFile(join(server.root, path), 'const initial = true\n')
  const initial = await fetchFile(path, new AbortController().signal, client)
  await writeFile(join(server.root, path), 'const latest = true\n')
  const latest = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const stop = documents.subscribeEditorAnalyses(() => {
    stop()
    documents.forceReplaceLiveDocument(latest)
  })
  onTestFinished(stop)
  const ensured = documents.ensureLiveDocument(initial)
  expect(ensured).toBe(documents.getLiveDocument(ensured.key))
  expect(ensured.buffer.materializeFullText()).toBe('const latest = true\n')
  expect(documents.state().documentContentRevisions[ensured.key]).toBe(ensured.contentRevision)
  const source = documents.acquireFilePreparation({
    kind: 'live-document',
    documentKey: ensured.key,
  })!
  expect(source.document).toBe(ensured)
  source.release()
})

test('delete rollback restores bookkeeping before a membership callback edits its buffer', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('rollback-admission.ts')
  await writeFile(join(server.root, path), 'const restored = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const before = documents.ensureLiveDocument(file)
  const projection = documents.prepareDeleteProjection(path)!
  expect(documents.commitProjection(projection)).toBe(true)
  const stop = documents.subscribeEditorAnalyses(() => {
    const current = documents.getLiveDocument(before.key)
    if (current) createEditorBufferSession(current.buffer).applyText(' edited')
  })
  onTestFinished(stop)
  expect(documents.rollbackProjection(projection)).toBe(true)
  const current = documents.getLiveDocument(before.key)!
  expect(current.buffer).toBe(before.buffer)
  expect(current.buffer.materializeFullText()).toBe('const restored = true\n edited')
  expect(current.localRevision).toBe(current.buffer.getRevision())
  expect(documents.state().dirtyDocumentKeys.has(current.key)).toBe(true)
  expect(documents.state().documentContentRevisions[current.key]).toBe(current.contentRevision)
  expect(current.buffer.canUndo()).toBe(true)
})

test('canonical preparation pins independently protect text until each caller releases', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('pins.ts')
  await writeFile(join(server.root, path), 'const pinned = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const first = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })
  expect(first).not.toBeNull()
  const second = documents.acquireFilePreparation({
    kind: 'live-document',
    documentKey: first!.document.key,
  })
  expect(second?.document.buffer).toBe(first?.document.buffer)
  expect(second?.document.analysis).toBe(first?.document.analysis)
  const keep = { documentKeys: new Set<DocumentKey>(), tabIds: new Set<TabId>() }
  expect(documents.retain(keep).evictedDocumentKeys).toEqual([])
  first?.release()
  first?.release()
  expect(documents.retain(keep).evictedDocumentKeys).toEqual([])
  second?.release()
  expect(documents.retain(keep).evictedDocumentKeys).toEqual([first?.document.key])
})

test('captured preparation preserves dirty authority, Undo, snapshot and mutation stamp', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('dirty.ts')
  await writeFile(join(server.root, path), 'const saved = true\n')
  const saved = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const live = documents.ensureLiveDocument(saved)
  createEditorBufferSession(live.buffer).applyText(' edited')
  const snapshot = live.buffer.getSnapshot()
  const stamp = documents.prepareTargetStamp(live.key)
  await writeFile(join(server.root, path), 'const disk = false\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const source = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })
  expect(source?.document.buffer).toBe(live.buffer)
  expect(source?.document.analysis).toBe(live.analysis)
  expect(source?.document.buffer.getSnapshot()).toBe(snapshot)
  expect(source?.document.localRevision).toBe(live.buffer.getRevision())
  expect(live.buffer.canUndo()).toBe(true)
  expect(stamp && documents.isTargetStampCurrent(stamp)).toBe(true)
  source?.release()
  documents.retain({ documentKeys: new Set(), tabIds: new Set() })
  expect(documents.getLiveDocument(live.key)?.buffer).toBe(live.buffer)
})

test('a reentrant membership edit is part of the acquired canonical revision', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('reentrant-revision.ts')
  await writeFile(join(server.root, path), 'const saved = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  documents.subscribeEditorAnalyses(() => {
    const analysis = Array.from(documents.enumerateEditorAnalyses())[0]
    if (analysis) createEditorBufferSession(analysis.buffer).applyText(' edited')
  })
  const source = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })!
  expect(source.document.localRevision).toBe(source.document.buffer.getRevision())
  expect(documents.getLiveDocument(source.document.key)).toBe(source.document)
  expect(source.document.buffer.isDirty()).toBe(true)
  expect(source.document.buffer.canUndo()).toBe(true)
  source.release()
})

test('pins cannot veto replacement, rename, deletion or final owner disposal', async ({
  server,
  client,
}) => {
  const path = filesystemPath('explicit.ts')
  await writeFile(join(server.root, path), 'const old = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  const first = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })
  await writeFile(join(server.root, path), 'const replacement = true\n')
  const replacement = await fetchFile(path, new AbortController().signal, client)
  documents.forceReplaceLiveDocument(replacement)
  expect(documents.getLiveDocument(first!.document.key)?.buffer).not.toBe(first?.document.buffer)
  const second = documents.acquireFilePreparation({
    kind: 'captured-file-snapshot',
    file: replacement,
  })
  documents.renameLiveDocument(path, filesystemPath('renamed.ts'))
  first?.release()
  second?.release()
  expect(documents.getLiveDocument(second!.document.key)).toBeNull()
  expect(
    documents.retain({ documentKeys: new Set(), tabIds: new Set() }).evictedDocumentKeys,
  ).toHaveLength(1)
  const third = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })
  documents.deleteLiveDocument(third!.document.key)
  third?.release()
  const fourth = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })
  documents.dispose()
  fourth?.release()
  expect([...documents.enumerateEditorAnalyses()]).toEqual([])
  expect(documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })).toBeNull()
})

test('actual analysis membership changes before publication and former provider disposal', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('membership.ts')
  await writeFile(join(server.root, path), 'const original = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const documents = new WorkspaceDocumentService()
  onTestFinished(() => documents.dispose())
  const old = documents.ensureLiveDocument(file)
  const seen: EditorDocumentAnalysis[][] = []
  const stop = documents.subscribeEditorAnalyses(() =>
    seen.push([...documents.enumerateEditorAnalyses()]),
  )
  const disposed: EditorDocumentAnalysis[][] = []
  const lease = old.analysis.borrowStructural({
    languageId: 'typescript',
    provider: retentionProvider(() => disposed.push([...documents.enumerateEditorAnalyses()])),
  })
  await lease?.refresh(old.buffer.getTextSnapshot())
  await writeFile(join(server.root, path), 'const next = true\n')
  documents.forceReplaceLiveDocument(await fetchFile(path, new AbortController().signal, client))
  const current = documents.getLiveDocument(old.key)!
  expect(seen).toEqual([[current.analysis]])
  expect(disposed).toEqual([[current.analysis]])
  documents.deleteLiveDocument(current.key)
  expect(seen.at(-1)).toEqual([])
  stop()
})

test.for(['file', 'live'] as const)(
  'a refused $0 view releases the activation claim and prepared resources',
  async (kind, { server, client, onTestFinished }) => {
    const path = filesystemPath('refused.ts')
    await writeFile(join(server.root, path), 'const refused = true\n')
    const file = await fetchFile(path, new AbortController().signal, client)
    const documents = new WorkspaceDocumentService()
    onTestFinished(() => documents.dispose())
    const source = documents.acquireFilePreparation({ kind: 'captured-file-snapshot', file })!
    const { document } = source
    const prepared = createPlatformFileOpenPreparer(preparationEnvironment).prepare(
      document.buffer,
      document.key,
      path,
      new AbortController().signal,
      { startIndex: 0, endIndex: 20 },
      document.analysis,
    )
    const claim = {
      buffer: document.buffer,
      documentKey: document.key,
      kind: 'live' as const,
      localRevision: document.localRevision,
      path,
      preparedDocument: prepared.preparedDocument,
      release: source.release,
      snapshot: document.buffer.getSnapshot(),
    }
    const reserved = documents.reservePaths(
      [documents.preparePathReservation(path)],
      'refusal-control',
    )
    expect(reserved.status).toBe('acquired')
    expect(() =>
      kind === 'file'
        ? documents.ensureView(tabId('refused'), file, claim)
        : documents.ensureViewForDocument(tabId('refused'), document.key, claim),
    ).toThrow()
    if (reserved.status === 'acquired') documents.releasePaths(reserved.reservation)
    expect(
      documents.retain({ documentKeys: new Set(), tabIds: new Set() }).evictedDocumentKeys,
    ).toEqual([document.key])
    expect(
      prepared.preparedDocument.borrow({
        configuredTabSize: 4,
        tabSizePolicy: 'detect-indentation',
        documentId: document.key,
        languageId: 'typescript',
        snapshot: claim.snapshot,
        documentConfigurationTag: prepared.documentConfigurationTag,
        highlighterProvider: null,
        structuralProvider: null,
        structuralConfiguration: null,
        highlighterConfigurationTag: [],
        structuralConfigurationTag: [],
      }),
    ).toBeNull()
  },
)
