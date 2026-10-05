import { act, waitFor } from '@testing-library/react'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import { createFileSyncPorts } from '@/features/editor/utils/file-sync-ports'
import { savedDiffAttachment, diffAttachmentSubject } from '@/lib/diff-attachment'
import { activeEditorTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { documentTab } from '@/lib/documents/utils/tabs'
import { fileDocumentKey, fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { ensureFileSnapshotQuery, setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { expect, test } from '../../../../test/fixtures'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import { observeDiffEditors } from '../../../../test/factories/diff-attachment'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'

test('two attached Saved views survive independent copy, move, Save, Undo, disk refresh and final release', async ({
  server,
  client,
}) => {
  stubHighlightApi()
  stubEditorViewport({ height: 120, width: 300 })
  const path = filesystemPath('repo/attached.ts')
  const original =
    Array.from(
      { length: 80 },
      (_, index) => `export const line${index + 1} = "${'x'.repeat(80)}";`,
    ).join('\n') + '\n'
  await mkdir(join(server.root, 'repo'), { recursive: true })
  await writeFile(join(server.root, path), original)
  const app = await mountRetentionAcceptanceApp()
  await ensureFileSnapshotQuery(app.queryClient, path)
  expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
  const live = app.read().documents.getState().getLiveEditorDocument(fileDocumentKey(path))!
  const editing = createEditorBufferSession(live.buffer)
  const changed = original.replace('line2 =', 'second =').replace('line55 =', 'later =')
  act(() => {
    editing.setSelection(0, original.length)
    editing.applyText(changed)
    editing.breakTypingRun()
  })
  const observed = observeDiffEditors()
  expect(
    await app
      .read()
      .commands.openTabContent(documentTab({ kind: 'compare-saved', file: fileResource(path) })),
  ).toMatchObject({ status: 'applied' })
  const originalTab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)!
  await waitFor(() => expect(observed.all()).toHaveLength(1))
  const first = observed.all()[0]!.editor
  const firstPresentation = app.read().ui.getState().tabPresentation.get(originalTab.id)
  const groups = app.read().workspace.getState().workbenchPanels.editorGroups
  expect(
    await app.read().commands.placeTab({
      tabId: originalTab.id,
      mode: 'copy',
      target: { kind: 'edge', groupId: groups.activeGroupId, edge: 'right' },
    }),
  ).toMatchObject({ status: 'applied' })
  await waitFor(() => expect(observed.all()).toHaveLength(2))
  const copy = allEditorGroups(app.read().workspace.getState().workbenchPanels.editorGroups)
    .flatMap((group) => group.tabs)
    .find(
      (tab) =>
        tab.id !== originalTab.id &&
        tab.content.kind === 'document' &&
        tab.content.document.kind === 'compare-saved',
    )!
  const copyPresentation = app.read().ui.getState().tabPresentation.get(copy.id)
  const second = observed.all().find((entry) => entry.editor !== first)!.editor
  const reads = [originalTab.id, copy.id].map((id) =>
    app.read().documents.getState().savedComparisonTabs.get(id)!.read(),
  )
  if (reads[0]!.kind !== 'ready' || reads[1]!.kind !== 'ready')
    throw new RangeError('Actual copied Saved reads required')
  expect(reads[0]!.live.buffer).toBe(live.buffer)
  expect(reads[1]!.live.buffer).toBe(live.buffer)
  expect(reads[0]!.live.analysis).toBe(reads[1]!.live.analysis)
  expect(reads[0]!.saved.snapshot).toBe(reads[1]!.saved.snapshot)
  expect(first.getState().documentId).toBe(
    `projection:diff:${diffAttachmentSubject(savedDiffAttachment(reads[0]!)).key}:stacked`,
  )
  act(() => {
    first.setSelection(3, 7, { reveal: false })
    second.setSelection(10, 5, { reveal: false })
    first.setScrollPosition({ top: 72, left: 20 })
    second.setScrollPosition({ top: 120, left: 40 })
    const gap = copyPresentation.diffPanes.stacked.plugin!.getRows().find((row) => row.expandKey)!
    copyPresentation.diffPanes.stacked.plugin!.toggleRegion(gap.expandKey!)
  })
  expect(first.getSelections()).not.toEqual(second.getSelections())
  expect(first.getScrollPosition()).not.toEqual(second.getScrollPosition())
  expect(firstPresentation.regions.getExpandedRegions().size).toBe(0)
  expect(copyPresentation.regions.getExpandedRegions().size).toBe(1)
  await waitFor(() =>
    expect(firstPresentation.diffPanes.stacked.scroll).toEqual(first.getScrollPosition()),
  )
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const survivorState = { selection: first.getSelections(), scroll: first.getScrollPosition() }
  expect(await app.read().commands.closeTab(copy.id)).toMatchObject({ status: 'applied' })
  await waitFor(() => expect(observed.all()).toHaveLength(1))
  expect(first.getSelections()).toEqual(survivorState.selection)
  expect(first.getScrollPosition()).toEqual(survivorState.scroll)
  expect(app.read().documents.getState().savedComparisonTabs.has(copy.id)).toBe(false)
  expect(app.read().documents.getState().savedComparisonTabs.get(originalTab.id)?.read().kind).toBe(
    'ready',
  )

  const currentGroups = app.read().workspace.getState().workbenchPanels.editorGroups
  expect(
    await app.read().commands.placeTab({
      tabId: originalTab.id,
      mode: 'move',
      target: { kind: 'edge', groupId: currentGroups.activeGroupId, edge: 'bottom' },
    }),
  ).toMatchObject({ status: 'applied' })
  await waitFor(() => expect(observed.all()).toHaveLength(1))
  const moved = observed.all()[0]!.editor
  expect(moved).not.toBe(first)
  expect(moved.getSelections()).toEqual(survivorState.selection)
  expect(moved.getScrollPosition()).toEqual(survivorState.scroll)
  const beforeLate = moved.materializeFullText()
  first.setTokens([{ start: 0, end: 1, style: { color: 'rgb(1, 2, 3)' } }])
  expect(moved.materializeFullText()).toBe(beforeLate)

  await act(() =>
    new FileSyncService(app.read().documents, app.queryClient, createFileSyncPorts(client)).save(
      app.read().documents.getState().getLiveEditorDocument(live.key)!,
    ),
  )
  expect(await readFile(join(server.root, path), 'utf8')).toBe(changed)
  await waitFor(() => expect(app.container.textContent).toContain('No unsaved changes.'))
  act(() => {
    editing.setSelection(0)
    editing.applyText('// later edit\n')
    editing.breakTypingRun()
  })
  await waitFor(() =>
    expect(observed.all()[0]?.editor.materializeFullText()).toContain('later edit'),
  )
  const afterSave = app.read().documents.getState().savedComparisonTabs.get(originalTab.id)!.read()
  if (afterSave.kind !== 'ready') throw new RangeError('Saved after-write source required')
  expect(afterSave.live.buffer).toBe(live.buffer)
  expect(afterSave.saved.snapshot).not.toBe(reads[0]!.saved.snapshot)
  act(() => editing.undo())
  expect(live.buffer.materializeFullText()).toBe(changed)
  expect(live.buffer.isDirty()).toBe(false)
  await waitFor(() => expect(app.container.textContent).toContain('No unsaved changes.'))

  await writeFile(join(server.root, path), original)
  const disk = await fetchFile(path, new AbortController().signal, client)
  act(() => setFileSnapshotQueryData(app.queryClient, disk))
  await waitFor(() => {
    const refreshed = app
      .read()
      .documents.getState()
      .savedComparisonTabs.get(originalTab.id)
      ?.read()
    expect(refreshed?.kind === 'ready' && refreshed.saved.snapshot.version).toBe(disk.version)
  })
  const beforeReplacementInstalls = observed.installations.length
  act(() => {
    app.read().documents.getState().forceReplaceLiveEditorDocument(disk)
    const replacement = app.read().documents.getState().getLiveEditorDocument(live.key)!
    const next = createEditorBufferSession(replacement.buffer)
    next.applyText('// incarnation\n')
  })
  await waitFor(() =>
    expect(observed.installations.length).toBeGreaterThan(beforeReplacementInstalls),
  )
  await waitFor(() =>
    expect(observed.all()[0]?.editor.materializeFullText()).toContain('incarnation'),
  )
  const replaced = app.read().documents.getState().savedComparisonTabs.get(originalTab.id)!.read()
  if (replaced.kind !== 'ready') throw new RangeError('Replacement Saved source required')
  expect(replaced.live.buffer).not.toBe(live.buffer)
  expect(replaced.live.snapshot.materializeFullText()).toContain('incarnation')
  expect(await app.read().commands.closeTab(originalTab.id)).toMatchObject({ status: 'applied' })
  expect(app.read().documents.getState().savedComparisonTabs.size).toBe(0)
  expect(app.read().documents.getState().savedComparisons.size).toBe(0)
  app.application.dispose()
  expect(app.read().documents.getState().getLiveEditorDocument(live.key)).toBeNull()
})
