import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { fetchFile } from '@/lib/file-server'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
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
