import { waitFor } from '@testing-library/react'
import { join } from 'node:path'
import { joinRenderLines } from '@singapore-editor/diff'
import type { GitComparison } from '@/lib/documents/utils/types'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { DiffView } from '@/features/git/components/diff-view'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import {
  diffAttachmentReferences,
  diffAttachmentRevision,
  diffAttachmentSubject,
  snapshotDiffAttachment,
} from '@/lib/diff-attachment'
import { snapshotComparisonInput } from '@/lib/snapshot-comparison-input'
import { capturedReviewDocument, historicalDocument } from '@/lib/documents/utils/comparisons'
import {
  checkpointFileDocument,
  checkpointSessionDocument,
  checkpointTurnDocument,
} from '@/lib/checkpoint-diff-query'
import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { documentTab } from '@/lib/documents/utils/tabs'
import { filesystemPath, tabId, workspaceRoot } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { checkpointTurn } from '../../../../test/factories/checkpoint-turn'
import { runGit } from '../../../../test/factories/git'
import {
  observeDiffEditors,
  mountDiffProjectionControl,
} from '../../../../test/factories/diff-attachment'
import { testDiffLanguageHost } from '../../../../test/factories/diff-language-host'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'

test.beforeEach(() => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
})

test('installed Git origins retain real scope, captured pair and equal-text subject separation', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const repo = join(server.root, 'repo')
  const parent = runGit(repo, ['rev-parse', 'HEAD']).stdout.trim()
  const tree = runGit(repo, ['write-tree']).stdout.trim()
  const commit = runGit(repo, [
    'commit-tree',
    tree,
    '-p',
    parent,
    '-m',
    'Second equal historical origin',
  ]).stdout.trim()
  const details = (
    await client.git.history.commit.get({ query: { path: f.scope.rootPath, commit } })
  ).data!
  const historical = historicalDocument({
    rootPath: f.scope.rootPath,
    details,
    file: details.files[0]!,
  })!
  const captured = capturedReviewDocument(f.worktree, f.scope.rootPath)!
  if (historical.source.kind !== 'snapshot' || captured.source.kind !== 'snapshot')
    throw new RangeError('Actual fixed source required')
  const secondHistorical = snapshotComparisonInput({
    scope: f.scope,
    comparison: historical.source,
    diffs: f.historicalDiffs,
  })
  const capturedInput = snapshotComparisonInput({
    scope: f.scope,
    comparison: captured.source,
    diffs: [f.worktree],
  })
  const inputs = [f.input, f.stagedInput, f.historicalInput, secondHistorical, capturedInput]
  const service = new WorkspaceDocumentService(() => undefined, f.scope.environmentId)
  const leases = inputs.map((input) =>
    service.acquireSnapshotComparison({ input, signal: new AbortController().signal }),
  )
  try {
    const attachments = leases.map((lease, index) => {
      const read = lease.read()
      if (read.kind !== 'ready' || read.input.kind !== 'snapshot')
        throw new RangeError('Actual Git read required')
      expect(read.input).toBe(inputs[index])
      expect(read.input.scope).toBe(f.scope)
      const child = read.input.files[0]!
      expect(child.kind).toBe('full')
      const attachment = snapshotDiffAttachment(read, read.input.display[0]!)!
      expect(attachment.kind === 'snapshot' && attachment.child).toBe(child)
      expect(diffAttachmentReferences(attachment)).toEqual([child])
      expect(diffAttachmentRevision(attachment)).toBe(JSON.stringify(read.input.revision))
      return attachment
    })
    const view = mountDiffProjectionControl(attachments[0]!)
    for (const attachment of attachments) {
      view.publish(attachment)
      expect(view.editor.getState().documentId).toBe(
        `projection:diff:${diffAttachmentSubject(attachment).key}:stacked`,
      )
      expect(view.editor.materializeFullText()).toBe(joinRenderLines(view.plugin.getRows()))
      expect(view.snapshot().languageId).toBeNull()
    }
    const firstHistorical = attachments[2]!
    const otherHistorical = attachments[3]!
    expect(firstHistorical.file.oldLines).toEqual(otherHistorical.file.oldLines)
    expect(firstHistorical.file.newLines).toEqual(otherHistorical.file.newLines)
    expect(diffAttachmentSubject(firstHistorical)).not.toEqual(
      diffAttachmentSubject(otherHistorical),
    )
    view.publish(firstHistorical)
    const firstId = view.editor.getState().documentId
    view.editor.setSelection(5, 2, { reveal: false })
    view.publish(otherHistorical)
    expect(view.editor.getState().documentId).not.toBe(firstId)
    expect(view.editor.getSelections()[0]).toMatchObject({ anchorOffset: 0, headOffset: 0 })
    view.publish(firstHistorical)
    expect(view.editor.getSelections()[0]).toMatchObject({ anchorOffset: 5, headOffset: 2 })
  } finally {
    for (const lease of leases) lease.release()
    expect(service.state().snapshotComparisons.size).toBe(0)
    service.dispose()
  }
})

for (const kind of ['file', 'turn', 'session'] as const) {
  test(`installed checkpoint ${kind} couples actual policy, displayed child and captured revision`, async ({
    client,
    server,
  }) => {
    const h = await checkpointTurn(client, server)
    const runtime = h.application.getSnapshot().editor
    const queries = runtime.queryClient
    const root = workspaceRoot(runtime.workspaceStore.getState().rootFolder!.path)
    const turn = checkpointTurnDocument(h.summary, root, false)
    const list = await queries.query(snapshotComparisonQueryOptions(turn.source))
    let document: { kind: 'git-diff'; source: GitComparison } = turn
    if (kind === 'file')
      document = checkpointFileDocument(
        h.summary,
        filesystemPath(list[0]!.path),
        list[0]!,
        root,
        false,
      )
    if (kind === 'session') document = checkpointSessionDocument(h.summary, root, false)
    await queries.query(snapshotComparisonQueryOptions(document.source))
    const tab = tabId(`attachment-${kind}`)
    runtime.editorActivation.activate(documentTab(document), tab)
    const observed = observeDiffEditors()
    const body = (comparison: GitComparison) => (
      <EditorStateProvider runtime={runtime}>
        <DiffView
          comparison={comparison}
          rootPath={root}
          languageHost={testDiffLanguageHost}
          tabId={tab}
        />
      </EditorStateProvider>
    )
    const rendered = renderWithProviders(body(document.source), {
      application: h.application,
      queryClient: queries,
    })
    try {
      const readSource = () =>
        [...runtime.documentStore.getState().snapshotComparisons.values()].find(
          (read) => read.kind === 'ready' && read.input.kind === 'checkpoint',
        )
      await waitFor(() => {
        const read = readSource()
        expect(
          read?.kind === 'ready' && read.input.kind === 'checkpoint' && read.input.files[0]?.kind,
        ).toBe('full')
      })
      const read = readSource()
      if (read?.kind !== 'ready' || read.input.kind !== 'checkpoint')
        throw new RangeError('Actual checkpoint read required')
      const child = read.input.files[0]!
      const attachment = snapshotDiffAttachment(read, read.input.display[0]!)!
      await waitFor(() =>
        expect(observed.read('stacked').editor.materializeFullText()).toContain('after'),
      )
      const projection = observed.read('stacked')
      expect(attachment.kind === 'snapshot' && attachment.child).toBe(child)
      expect(read.input.comparison.ignoreWhitespace).toBe(false)
      expect(projection.editor.getState().documentId).toBe(
        `projection:diff:${diffAttachmentSubject(attachment).key}:stacked`,
      )
      expect(projection.editor.materializeFullText()).toContain('after')
      expect(diffAttachmentRevision(attachment)).toBe(
        JSON.stringify([child.revision, child.hunks.map((hunk) => hunk.id)]),
      )
      if (kind !== 'file') {
        expect(read.input.files[1]?.kind).toBe('partial')
        const next = checkpointFileDocument(
          h.summary,
          filesystemPath(list[1]!.path),
          list[1]!,
          root,
          false,
        )
        const oldId = projection.editor.getState().documentId
        await queries.query(snapshotComparisonQueryOptions(next.source))
        runtime.editorActivation.activate(documentTab(next), tab)
        rendered.rerender(body(next.source))
        await waitFor(() =>
          expect(observed.read('stacked').editor.getState().documentId).not.toBe(oldId),
        )
        expect(observed.read('stacked').editor.getScrollPosition().top).toBe(0)
      }
    } finally {
      rendered.unmount()
      h.application.dispose()
      queries.clear()
    }
  })
}
