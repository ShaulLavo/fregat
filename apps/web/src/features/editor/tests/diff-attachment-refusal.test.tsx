import { waitFor } from '@testing-library/react'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DiffEditor } from '@/features/editor/components/diff-editor'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { snapshotDiffAttachment } from '@/lib/diff-attachment'
import { diffLanguageDocuments } from '@/features/editor/utils/diff-documents'
import { snapshotComparisonInput } from '@/lib/snapshot-comparison-input'
import { capturedReviewDocument } from '@/lib/documents/utils/comparisons'
import { fetchDiff } from '@/lib/git-diff-query'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { testDiffLanguageHost } from '../../../../test/factories/diff-language-host'
import { stubHighlightApi } from '../../../../test/env/highlight-api'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'

test('an attached partial source has zero LSP document admission beside a complete worktree source', async ({
  client,
  server,
}) => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const f = await createSnapshotComparisonFixture(server.root, client)
  const service = new WorkspaceDocumentService(() => undefined, f.scope.environmentId)
  const full = service.acquireSnapshotComparison({
    input: f.input,
    signal: new AbortController().signal,
  })
  const partial = service.acquireSnapshotComparison({
    input: snapshotComparisonInput({
      scope: f.scope,
      comparison: f.stagedInput.comparison,
      diffs: [{ ...f.staged, oldText: undefined, newText: undefined }],
    }),
    signal: new AbortController().signal,
  })
  const fullRead = full.read()
  const partialRead = partial.read()
  if (
    fullRead.kind !== 'ready' ||
    fullRead.input.kind !== 'snapshot' ||
    partialRead.kind !== 'ready' ||
    partialRead.input.kind !== 'snapshot'
  )
    throw new RangeError('Actual admitted source reads required')
  const completeAttachment = snapshotDiffAttachment(fullRead, fullRead.input.display[0]!)!
  const partialAttachment = snapshotDiffAttachment(partialRead, partialRead.input.display[0]!)!
  expect(partialRead.input.files[0]?.kind).toBe('partial')
  expect(partialAttachment.file.isPartial).toBe(true)
  const fullDocuments = diffLanguageDocuments({
    documentPath: f.path,
    file: completeAttachment.file,
    newSideIsWorkingTree: true,
    ownedText: null,
  })
  const partialDocuments = diffLanguageDocuments({
    documentPath: f.path,
    file: partialAttachment.file,
    newSideIsWorkingTree: false,
    ownedText: null,
  })
  expect(fullDocuments).toHaveLength(2)
  expect(fullDocuments.some((document) => document.sharesRealUri)).toBe(true)
  expect(partialDocuments).toEqual([])
  const languageServer = {
    documentPath: f.path,
    host: testDiffLanguageHost,
    newSideIsWorkingTree: true,
    ownedText: null,
    rootPath: f.scope.rootPath,
  }
  const body = (showPartial: boolean) => (
    <>
      <section aria-label='Complete source'>
        <DiffEditor
          attachment={completeAttachment}
          mode='stacked'
          languageServer={languageServer}
        />
      </section>
      {showPartial && (
        <section aria-label='Partial source'>
          <DiffEditor
            attachment={partialAttachment}
            mode='stacked'
            languageServer={languageServer}
          />
        </section>
      )}
    </>
  )
  const rendered = renderWithProviders(body(false))
  try {
    await waitFor(() =>
      expect(rendered.container.querySelectorAll('.editor-diff-pane')).toHaveLength(1),
    )
    rendered.rerender(body(true))
    await waitFor(() =>
      expect(rendered.container.querySelectorAll('.editor-diff-pane')).toHaveLength(2),
    )
    expect(
      rendered.container
        .querySelector('section[aria-label="Partial source"] .editor-diff-pane')
        ?.getAttribute('data-syntax'),
    ).toBe('off')
    expect(full.read()).toBe(fullRead)
    expect(partial.read()).toBe(partialRead)
  } finally {
    rendered.unmount()
    full.release()
    partial.release()
    service.dispose()
  }
})

test('actual binary, unavailable, missing and complete-empty captures keep distinct attachment admission', async ({
  client,
  server,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const fixed = capturedReviewDocument(f.worktree, f.scope.rootPath)!
  if (fixed.source.kind !== 'snapshot') throw new RangeError('Actual captured authority required')
  const parse = (diff: typeof f.worktree) =>
    snapshotComparisonInput({ scope: f.scope, comparison: f.comparison, diffs: [diff] })
  await writeFile(join(server.root, f.path), '')
  const [empty] = await fetchDiff(f.path, false, undefined, client)
  const emptyInput = parse(empty!)
  const emptyChild = emptyInput.files[0]
  expect(emptyChild?.kind).toBe('full')
  if (emptyChild?.kind !== 'full') throw new RangeError('Actual empty source required')
  expect(emptyChild.new).toMatchObject({ kind: 'blob', text: '' })
  expect(
    snapshotComparisonInput({ scope: f.scope, comparison: fixed.source, diffs: [empty!] }).files[0],
  ).toEqual({ kind: 'no-text', reason: 'unavailable' })
  await writeFile(join(server.root, f.path), new Uint8Array([0, 1, 2]))
  const [binary] = await fetchDiff(f.path, false, undefined, client)
  const binaryInput = parse(binary!)
  expect(binaryInput.files[0]).toEqual({ kind: 'no-text', reason: 'binary' })
  await unlink(join(server.root, f.path))
  const [missing] = await fetchDiff(f.path, false, undefined, client)
  const missingInput = parse(missing!)
  const missingChild = missingInput.files[0]
  expect(missingChild?.kind).toBe('full')
  if (missingChild?.kind !== 'full') throw new RangeError('Actual missing side required')
  expect(missingChild.new.kind).toBe('missing')
  const owner = new WorkspaceDocumentService(() => undefined, f.scope.environmentId)
  try {
    for (const input of [emptyInput, binaryInput, missingInput]) {
      const lease = owner.acquireSnapshotComparison({ input, signal: new AbortController().signal })
      const read = lease.read()
      if (read.kind !== 'ready' || read.input.kind !== 'snapshot')
        throw new RangeError('Actual capture required')
      const attachment = snapshotDiffAttachment(read, read.input.display[0] ?? null)
      expect(attachment === null).toBe(input === binaryInput)
      lease.release()
    }
  } finally {
    owner.dispose()
  }
})
