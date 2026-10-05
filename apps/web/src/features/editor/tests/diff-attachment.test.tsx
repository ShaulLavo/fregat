import { renderHook } from '@testing-library/react'
import { useDiffPanes } from '@/features/editor/hooks/use-diff-panes'
import { historyComparisonFixture } from '../../../../test/factories/history-document'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import {
  historyComparisonInput,
  compareHistoryStates,
} from '@/features/editor/utils/history-compare'
import { createTextDiff, parseGitPatch } from '@singapore-editor/diff'
import { Editor } from '@singapore-editor/core/editor'
import { waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { DiffEditor } from '@/features/editor/components/diff-editor'
import { createTabPresentation } from '@/features/editor/state/tab-presentation'
import { renderWithProviders } from '../../../../test/render'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '../../../../test/fixtures'
import {
  projectionControl,
  mountDiffProjectionControl,
  observeDiffEditors,
} from '../../../../test/factories/diff-attachment'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { TabPresentations } from '@/features/editor/state/tab-presentation'
import {
  diffAttachmentRevision,
  diffAttachmentSubject,
  snapshotDiffAttachment,
  historyDiffAttachment,
} from '@/lib/diff-attachment'
import { snapshotComparisonInput } from '@/lib/snapshot-comparison-input'
import { fetchDiff } from '@/lib/git-diff-query'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'

test.beforeEach(() => {
  stubHighlightApi()
  stubEditorViewport({ height: 120, width: 300 })
})

test('the completed source identity refuses intermediate rows and installs once', async () => {
  const first = projectionControl(
    createTextDiff({
      oldFile: { path: 'source', text: 'base' },
      newFile: { path: 'source', text: 'first' },
    }),
    'moving',
    'first',
  )
  const next = projectionControl(
    createTextDiff({
      oldFile: { path: 'source', text: 'base' },
      newFile: { path: 'source', text: 'second' },
    }),
    'moving',
    'second',
  )
  const presentation = createTabPresentation()
  const sync = vi.spyOn(Editor.prototype, 'syncText')
  let notified = 0
  const rendered = renderWithProviders(
    <DiffEditor attachment={first} mode='stacked' presentation={presentation} />,
  )
  try {
    await waitFor(() => expect(rendered.container.textContent).toContain('first'))
    const events = presentation.diffPanes.stacked.plugin?.onDidChangeRows(() => {
      notified += 1
    })
    sync.mockClear()
    rendered.rerender(<DiffEditor attachment={next} mode='stacked' presentation={presentation} />)
    await waitFor(() => expect(rendered.container.textContent).toContain('second'))
    expect(notified).toBe(2)
    expect(sync).toHaveBeenCalledTimes(1)
    events?.dispose()
  } finally {
    sync.mockRestore()
  }
})

test('calibrates actual projection identity and refuses an unrelated displayed child', async ({
  server,
  client,
}) => {
  const fixture = await createSnapshotComparisonFixture(server.root, client)
  const service = new WorkspaceDocumentService(() => undefined, fixture.scope.environmentId)
  const lease = service.acquireSnapshotComparison({
    input: fixture.input,
    signal: new AbortController().signal,
  })
  try {
    const read = lease.read()
    if (read.kind !== 'ready' || read.input.kind !== 'snapshot')
      throw new RangeError('Actual ready snapshot required')
    const file = read.input.display[0]!
    const attachment = snapshotDiffAttachment(read, file)
    if (!attachment) throw new RangeError('Actual child required')
    const view = mountDiffProjectionControl(attachment)
    await waitFor(() => expect(view.editor.getState().documentId).toContain('projection:diff:'))
    expect(view.editor.materializeFullText()).toContain('DISK')
    expect(snapshotDiffAttachment(read, { ...file })).toBeNull()
    expect(view.snapshot().textSnapshot.readRange(0, view.snapshot().textSnapshot.length)).toBe(
      view.editor.materializeFullText(),
    )
    expect(JSON.parse(diffAttachmentSubject(attachment).key)).toContain(read.input.subject)
  } finally {
    lease.release()
    service.dispose()
  }
})

test('actual moving Git revision updates the retained subject and installed projection', async ({
  server,
  client,
}) => {
  const fixture = await createSnapshotComparisonFixture(server.root, client)
  const service = new WorkspaceDocumentService(() => undefined, fixture.scope.environmentId)
  const lease = service.acquireSnapshotComparison({
    input: fixture.input,
    signal: new AbortController().signal,
  })
  try {
    const first = lease.read()
    if (first.kind !== 'ready' || first.input.kind !== 'snapshot')
      throw new RangeError('Actual ready snapshot required')
    const attachment = snapshotDiffAttachment(first, first.input.display[0]!)
    if (!attachment) throw new RangeError('Actual child required')
    const view = mountDiffProjectionControl(attachment)
    const documentId = view.editor.getState().documentId
    await writeFile(
      join(server.root, fixture.path),
      'export const inserted = true\nexport const authority = "DISK"\n',
    )
    const diffs = await fetchDiff(fixture.path, false, undefined, client)
    const input = snapshotComparisonInput({
      scope: fixture.scope,
      comparison: fixture.comparison,
      diffs,
    })
    expect(lease.refresh(input, lease.requestRefresh())).toBe(true)
    const latest = lease.read()
    if (latest.kind !== 'ready' || latest.input.kind !== 'snapshot')
      throw new RangeError('Actual refreshed snapshot required')
    const next = snapshotDiffAttachment(latest, latest.input.display[0]!)
    if (!next) throw new RangeError('Actual refreshed child required')
    expect(diffAttachmentRevision(next)).not.toBe(diffAttachmentRevision(attachment))
    expect(diffAttachmentSubject(next)).toEqual(diffAttachmentSubject(attachment))
    view.publish(next)
    expect(view.editor.getState().documentId).toBe(documentId)
    expect(view.editor.materializeFullText()).toContain('inserted')
    expect(service.state().snapshotComparisons.size).toBe(1)
  } finally {
    lease.release()
    expect(service.state().snapshotComparisons.size).toBe(0)
    service.dispose()
  }
})

test('expansion retains both reversed selection endpoints and the later source row displacement', async () => {
  const original = Array.from(
    { length: 70 },
    (_, index) => `const line${index + 1} = "${'x'.repeat(80)}";`,
  )
  const changed = original.map((line, index) =>
    index === 1 || index === 54 ? line.replace('const', 'let') : line,
  )
  const attachment = projectionControl(
    createTextDiff({
      oldFile: { path: 'source.ts', text: original.join('\n') },
      newFile: { path: 'source.ts', text: changed.join('\n') },
    }),
  )
  const view = mountDiffProjectionControl(attachment)
  await waitFor(() => expect(view.snapshot().viewport.clientHeight).toBeGreaterThan(0))
  const start = view.offset(55)
  view.editor.setSelection(start + 7, start + 4, { reveal: false })
  const beforeRow = view.plugin.getRows().findIndex((row) => row.newLineNumber === 55)
  view.editor.setScrollPosition({
    top: beforeRow * view.snapshot().metrics.rowHeight - 24,
    left: 40,
  })
  const before = view.editor.getScrollPosition()
  expect(before.top).toBeGreaterThan(0)
  const displacement = beforeRow * view.snapshot().metrics.rowHeight - before.top
  const separator = view.plugin.getRows().find((row) => row.expandKey)
  if (!separator?.expandKey) throw new RangeError('Actual collapsed region required')
  view.plugin.toggleRegion(separator.expandKey)
  const after = view.snapshot()
  const nextStart = view.offset(55)
  expect(after.selections[0]).toMatchObject({
    anchorOffset: nextStart + 7,
    headOffset: nextStart + 4,
  })
  const afterRow = view.plugin.getRows().findIndex((row) => row.newLineNumber === 55)
  expect(afterRow * after.metrics.rowHeight - view.editor.getScrollPosition().top).toBe(
    displacement,
  )
  expect(view.editor.getScrollPosition().left).toBe(before.left)
  expect(view.editor.getScrollPosition().top).toBeGreaterThan(before.top)
})

for (const control of [
  {
    name: 'inserted source prefix',
    before: ['a', 'b', 'anchor', 'd'],
    after: ['prefix', 'a', 'b', 'anchor', 'd'],
    line: 3,
    expected: 'anchor',
  },
  {
    name: 'unique moved block',
    before: ['a', 'anchor', 'unique', 'b', 'c', 'd'],
    after: ['a', 'b', 'c', 'd', 'anchor', 'unique'],
    line: 2,
    expected: 'anchor',
  },
  {
    name: 'unique moved sub-block beside discarded text',
    before: ['a', 'discard', 'anchor', 'unique', 'b', 'c', 'd'],
    after: ['a', 'b', 'c', 'd', 'anchor', 'unique'],
    line: 3,
    expected: 'anchor',
  },
  {
    name: 'deleted anchor boundary',
    before: ['a', 'anchor', 'b', 'c'],
    after: ['a', 'b', 'c'],
    line: 2,
    expected: 'b',
  },
  {
    name: 'repeated move uses deletion boundary',
    before: ['a', 'anchor', 'repeat', 'b', 'anchor', 'repeat', 'c'],
    after: ['a', 'b', 'anchor', 'repeat', 'c', 'anchor', 'repeat'],
    line: 2,
    expected: 'b',
  },
  {
    name: 'whole side replacement',
    before: ['a', 'anchor', 'b'],
    after: ['replacement'],
    line: 2,
    expected: 'replac',
  },
] as const) {
  test(`same subject maps ${control.name}`, () => {
    const oldFile = { path: 'source.txt', text: 'base' }
    const first = projectionControl(
      createTextDiff({
        oldFile,
        newFile: { path: 'source.txt', text: control.before.join('\n') },
        contextLines: 20,
      }),
      'moving',
      'first',
    )
    const view = mountDiffProjectionControl(first)
    const start = view.offset(control.line)
    const end = start + control.before[control.line - 1]!.length
    const reversed = control.name === 'unique moved sub-block beside discarded text'
    view.editor.setSelection(reversed ? end : start, reversed ? start : end, { reveal: false })
    const next = projectionControl(
      createTextDiff({
        oldFile,
        newFile: { path: 'source.txt', text: control.after.join('\n') },
        contextLines: 20,
      }),
      'moving',
      'next',
    )
    view.publish(next)
    const selection = view.snapshot().selections[0]!
    expect(
      view.editor.materializeFullText().slice(selection.startOffset, selection.endOffset),
    ).toBe(control.expected)
    if (reversed) expect(selection.anchorOffset).toBeGreaterThan(selection.headOffset)
  })
}

test('subjects revisit independently and exact claims are copied without sharing mutable maps', () => {
  const first = projectionControl(
    createTextDiff({
      oldFile: { path: 'source', text: 'before' },
      newFile: { path: 'source', text: 'after' },
    }),
    'A',
  )
  const second = projectionControl(first.file, 'B')
  const tabs = new TabPresentations()
  const id = tabId('source')
  const owner = tabs.get(id)
  const presentation = owner.diffPanes.stacked
  const view = mountDiffProjectionControl(first, 'stacked', presentation)
  view.editor.setSelection(8, 10, { reveal: false })
  view.publish(second)
  expect(view.snapshot().selections[0]).toMatchObject({ anchorOffset: 0, headOffset: 0 })
  view.publish(first)
  expect(view.snapshot().selections[0]).toMatchObject({ anchorOffset: 8, headOffset: 10 })
  tabs.copy(id, tabId('copy'))
  const copy = tabs.get(tabId('copy')).diffPanes.stacked
  expect(copy.views).not.toBe(presentation.views)
  expect([...copy.views.keys()]).toEqual([...presentation.views.keys()])
  copy.views.clear()
  expect(presentation.views.size).toBe(2)
  tabs.retain(new Set())
  expect(tabs.get(id)).not.toBe(owner)
  expect(tabs.get(id).diffPanes.stacked.views.size).toBe(0)
  view.binding.detach()
  const reopened = mountDiffProjectionControl(
    projectionControl({ ...first.file }, 'A'),
    'stacked',
    presentation,
  )
  expect(reopened.snapshot().selections[0]).toMatchObject({ anchorOffset: 0, headOffset: 0 })
})

test('collapsed viewport anchors use the owning separator while hidden selections use the nearest source boundary', async () => {
  const lines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`)
  const changed = lines.map((line, index) =>
    index === 1 || index === 54 ? `${line} changed` : line,
  )
  const view = mountDiffProjectionControl(
    projectionControl(
      createTextDiff({
        oldFile: { path: 'source', text: lines.join('\n') },
        newFile: { path: 'source', text: changed.join('\n') },
      }),
    ),
  )
  await waitFor(() => expect(view.snapshot().viewport.clientHeight).toBeGreaterThan(0))
  const key = view.plugin.getRows().find((row) => row.expandKey)?.expandKey
  if (!key) throw new RangeError('Collapsed region required')
  view.plugin.toggleRegion(key)
  const offset = view.offset(25)
  view.editor.setSelection(offset, offset + 4, { reveal: false })
  const row = view.plugin.getRows().findIndex((entry) => entry.newLineNumber === 25)
  view.editor.setScrollPosition({ top: row * view.snapshot().metrics.rowHeight })
  view.plugin.toggleRegion(key)
  const separator = view.plugin.getRows().findIndex((entry) => entry.expandKey === key)
  expect(view.editor.getScrollPosition().top).toBe(separator * view.snapshot().metrics.rowHeight)
  const selection = view.snapshot().selections[0]!
  const nearest = view.offset(5)
  expect(selection.anchorOffset).toBe(nearest)
  expect(selection.headOffset).toBe(nearest + 4)
})

for (const separator of ['\r\n', '\r', '\u2028', '\u2029']) {
  test(`normalized ${JSON.stringify(separator)} and BOM retain honest same-input columns`, () => {
    const file = createTextDiff({
      oldFile: { path: 'source', text: `\uFEFFalpha${separator}before${separator}tail` },
      newFile: { path: 'source', text: `\uFEFFalpha${separator}after${separator}tail` },
    })
    const attachment = projectionControl(file)
    const view = mountDiffProjectionControl(attachment)
    const offset = view.editor.materializeFullText().indexOf('after')
    view.editor.setSelection(offset + 1, offset + 4, { reveal: false })
    view.publish(projectionControl({ ...file }, file.path, 'same'))
    const selected = view.snapshot().selections[0]!
    expect(view.editor.materializeFullText().slice(selected.startOffset, selected.endOffset)).toBe(
      'fte',
    )
    if (separator === '\r\n') return
    const changed = createTextDiff({
      oldFile: { path: 'source', text: `\uFEFFalpha${separator}before${separator}tail` },
      newFile: { path: 'source', text: `prefix${separator}alpha${separator}after${separator}tail` },
    })
    view.publish(projectionControl(changed, file.path, 'changed'))
    expect(view.snapshot().selections[0]).toMatchObject({ anchorOffset: 0, headOffset: 0 })
  })
}

test('partial rows retain display claims without complete source coordinates', () => {
  const [file] = parseGitPatch(
    'diff --git a/source b/source\nindex aaaaaaa..bbbbbbb 100644\n--- a/source\n+++ b/source\n@@ -20,1 +20,1 @@\n-before\n+after\n',
  )
  if (!file) throw new RangeError('Partial projection required')
  const view = mountDiffProjectionControl(projectionControl(file, 'partial'))
  view.editor.setSelection(view.offset(20), view.offset(20) + 3, { reveal: false })
  const claim = view.presentation.views.get('partial')
  expect(claim?.anchors.selections[0]?.anchor.kind).toBe('display')
  expect(view.plugin.getTokens()).toEqual([])
})

test('history revisit refuses different actual snapshots under equal node IDs and revisions', () => {
  const scope = { environmentId: testScopedStorage.environmentId, rootPath: filesystemPath('repo') }
  const path = filesystemPath('repo/source.txt')
  const first = historyComparisonFixture({ path, scope })
  const second = historyComparisonFixture({ path, scope })
  const graph = first.buffer.getHistoryGraph()
  const current = graph.nodes.find((node) => node.id === graph.currentId)!
  const focused = graph.nodes[0]!
  const input = historyComparisonInput(first.buffer, path, scope, current, focused)
  const otherGraph = second.buffer.getHistoryGraph()
  const otherCurrent = otherGraph.nodes.find((node) => node.id === otherGraph.currentId)!
  const altered = { ...input, old: { ...input.old, snapshot: otherCurrent.snapshot } }
  const owner = first.store.getState()
  const lease = owner.acquireSnapshotComparison({ input, signal: new AbortController().signal })
  const replacement = owner.acquireSnapshotComparison({
    input: altered,
    signal: new AbortController().signal,
  })
  try {
    const file = compareHistoryStates(input.old, input.new, path)
    if (file === 'too-large') throw new RangeError('Full history comparison required')
    const attachment = historyDiffAttachment(lease.read(), file, 'focused')
    if (!attachment) throw new RangeError('History attachment required')
    const view = mountDiffProjectionControl(attachment)
    view.editor.setSelection(2, 4, { reveal: false })
    view.binding.detach()
    const nextFile = compareHistoryStates(altered.old, altered.new, path)
    if (nextFile === 'too-large') throw new RangeError('Full replacement required')
    const next = historyDiffAttachment(replacement.read(), nextFile, 'focused')
    if (!next) throw new RangeError('Replacement attachment required')
    expect(diffAttachmentSubject(next)).toEqual(diffAttachmentSubject(attachment))
    expect(diffAttachmentRevision(next)).toEqual(diffAttachmentRevision(attachment))
    const reopened = mountDiffProjectionControl(next, 'stacked', view.presentation)
    expect(reopened.snapshot().selections[0]).toMatchObject({ anchorOffset: 0, headOffset: 0 })
  } finally {
    lease.release()
    replacement.release()
    first.store.getState().disposeEditorDocuments()
    second.store.getState().disposeEditorDocuments()
  }
})

test('split expansion retains the active pane selection and both source viewport positions', async () => {
  const before = Array.from({ length: 70 }, (_, index) => `line${index + 1} ${'x'.repeat(100)}`)
  const after = before.map((line, index) =>
    index === 1 || index === 54 ? `${line} changed` : line,
  )
  const attachment = projectionControl(
    createTextDiff({
      oldFile: { path: 'source.txt', text: before.join('\n') },
      newFile: { path: 'source.txt', text: after.join('\n') },
    }),
  )
  const presentation = createTabPresentation()
  const observed = observeDiffEditors()
  renderWithProviders(
    <DiffEditor attachment={attachment} mode='split' presentation={presentation} />,
  )
  await waitFor(() =>
    expect(observed.read('new').snapshot.viewport.clientHeight).toBeGreaterThan(0),
  )
  const plugin = presentation.diffPanes.new.plugin
  if (!plugin) throw new RangeError('Actual split plugin required')
  const index = plugin.getRows().findIndex((row) => row.newLineNumber === 55)
  const offset = plugin
    .getRows()
    .slice(0, index)
    .reduce((sum, row) => sum + row.text.length + 1, 0)
  const newSide = observed.read('new')
  newSide.editor.setScrollPosition({
    top: index * newSide.snapshot.metrics.rowHeight - 24,
    left: 40,
  })
  newSide.editor.setSelection(offset, offset + 6, { reveal: false })
  const oldScroll = newSide.editor.getScrollPosition()
  expect(oldScroll.top).toBeGreaterThan(0)
  const key = plugin.getRows().find((row) => row.expandKey)?.expandKey
  if (!key) throw new RangeError('Actual split collapsed range required')
  plugin.toggleRegion(key)
  const next = observed.read('new')
  const selected = next.snapshot.selections[0]!
  expect(next.editor.materializeFullText().slice(selected.startOffset, selected.endOffset)).toBe(
    'line55',
  )
  const row = plugin.getRows().findIndex((entry) => entry.newLineNumber === 55)
  expect(row * next.snapshot.metrics.rowHeight - next.editor.getScrollPosition().top).toBe(
    index * next.snapshot.metrics.rowHeight - oldScroll.top,
  )
  expect(observed.read('old').editor.getScrollPosition()).toEqual(next.editor.getScrollPosition())
  expect(next.editor.getScrollPosition().left).toBe(oldScroll.left)
})

test('split restoration and a delayed identical notification preserve user axis deltas', () => {
  const { result } = renderHook(() => useDiffPanes())
  const controller = result.current
  const file = createTextDiff({
    oldFile: {
      path: 'source.txt',
      text: Array.from({ length: 100 }, () => 'old ' + 'x'.repeat(90)).join('\n'),
    },
    newFile: {
      path: 'source.txt',
      text: Array.from({ length: 100 }, () => 'new ' + 'x'.repeat(130)).join('\n'),
    },
    contextLines: 100,
  })
  const left = mountDiffProjectionControl(projectionControl(file), 'old')
  const right = mountDiffProjectionControl(projectionControl(file), 'new')
  controller.registerEditor('old', left.editor)
  controller.registerEditor('new', right.editor)
  const l = left.editor.onDidScroll((position) =>
    controller.handleScroll(
      'old',
      position,
      left.binding.isRestoringProjection() ? 'restoration' : 'scroll',
    ),
  )
  const r = right.editor.onDidScroll((position) =>
    controller.handleScroll(
      'new',
      position,
      right.binding.isRestoringProjection() ? 'restoration' : 'scroll',
    ),
  )
  const mirrored = vi.spyOn(right.editor, 'setScrollPosition')
  try {
    left.editor.setScrollPosition({ top: 120, left: 40 })
    controller.handleScroll('old', left.editor.getScrollPosition(), 'restoration')
    controller.handleScroll('new', right.editor.getScrollPosition(), 'restoration')
    mirrored.mockClear()
    controller.handleScroll('old', left.editor.getScrollPosition(), 'scroll')
    expect(mirrored).not.toHaveBeenCalled()
    left.editor.setScrollPosition({ top: 168 })
    expect(mirrored).toHaveBeenCalledTimes(1)
    expect(right.editor.getScrollPosition()).toEqual(left.editor.getScrollPosition())
    mirrored.mockClear()
    left.editor.setScrollPosition({ left: 64 })
    expect(mirrored).toHaveBeenCalledTimes(1)
    expect(right.editor.getScrollPosition()).toEqual(left.editor.getScrollPosition())
  } finally {
    l.dispose()
    r.dispose()
    mirrored.mockRestore()
  }
})

test('a failing mirrored scroll listener releases the split interleaving guard', () => {
  const { result } = renderHook(() => useDiffPanes())
  const controller = result.current
  const file = createTextDiff({
    oldFile: {
      path: 'source.txt',
      text: Array.from({ length: 100 }, (_, index) => `old ${index}`).join('\n'),
    },
    newFile: {
      path: 'source.txt',
      text: Array.from({ length: 100 }, (_, index) => `new ${index}`).join('\n'),
    },
    contextLines: 100,
  })
  const left = mountDiffProjectionControl(projectionControl(file), 'old')
  const right = mountDiffProjectionControl(projectionControl(file), 'new')
  controller.registerEditor('old', left.editor)
  controller.registerEditor('new', right.editor)
  const l = left.editor.onDidScroll((position) =>
    controller.handleScroll('old', position, 'scroll'),
  )
  const r = right.editor.onDidScroll((position) =>
    controller.handleScroll('new', position, 'scroll'),
  )
  let reported = false
  const failed = right.editor.onDidScroll(() => {
    reported = true
    throw new RangeError('Injected mirrored scroll callback failure')
  })
  try {
    left.editor.setScrollPosition({ top: 120 })
    expect(reported).toBe(true)
    failed.dispose()
    right.editor.setScrollPosition({ top: 168 })
    expect(left.editor.getScrollPosition().top).toBe(168)
  } finally {
    failed.dispose()
    l.dispose()
    r.dispose()
  }
})
