import { waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { savedDiffAttachment, diffAttachmentSubject } from '@/lib/diff-attachment'
import { expect, test } from '../../../../test/fixtures'
import { createSavedComparisonFixture } from '../../../../test/factories/saved-comparison'
import { mountDiffProjectionControl } from '../../../../test/factories/diff-attachment'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'

const text =
  Array.from(
    { length: 80 },
    (_, index) => `export const source${index + 1} = "${'x'.repeat(100)}"`,
  ).join('\n') + '\n'

test('unmeasured invalid metrics retain an exact viewport claim and measured user top zero replaces it', async ({
  server,
  client,
}) => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const f = await createSavedComparisonFixture(server.root, client)
  const editing = createEditorBufferSession(f.document.buffer)
  editing.setSelection(0, f.document.buffer.getTextSnapshot().length)
  editing.applyText(text)
  const lease = f.acquire()
  try {
    const read = lease.read()
    if (read.kind !== 'ready') throw new RangeError('Actual Saved read required')
    const attachment = savedDiffAttachment(read)
    const view = mountDiffProjectionControl(attachment)
    await waitFor(() => expect(view.snapshot().viewport.clientHeight).toBe(120))
    view.editor.setSelection(view.offset(55) + 5, view.offset(55) + 2, { reveal: false })
    view.editor.setScrollPosition({ top: 600, left: 40 })
    const key = diffAttachmentSubject(attachment).key
    const prior = view.presentation.views.get(key)!.anchors.viewport
    expect(prior?.anchor.kind).toBe('source')
    const position = view.editor.getScrollPosition()
    const context = view.context()
    const snapshot = context.getSnapshot.bind(context)
    const unavailable = vi.spyOn(context, 'getSnapshot').mockImplementation(() => {
      const actual = snapshot()
      return {
        ...actual,
        metrics: { ...actual.metrics, rowHeight: 0 },
        visibleRows: [],
        viewport: { ...actual.viewport, clientHeight: 0 },
      }
    })
    try {
      view.publish({ ...attachment })
      expect(view.editor.getScrollPosition()).toEqual(position)
      expect(view.presentation.views.get(key)!.anchors.viewport).toEqual(prior)
    } finally {
      unavailable.mockRestore()
    }
    view.editor.setScrollPosition({ top: 0, left: 0 })
    expect(view.presentation.views.get(key)!.anchors.viewport?.withinRow).toBe(0)
    view.binding.detach()
    view.editor.dispose()
    const moved = mountDiffProjectionControl(attachment, 'stacked', view.presentation)
    await waitFor(() => expect(moved.snapshot().viewport.clientHeight).toBe(120))
    expect(moved.editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
  } finally {
    lease.release()
    f.service.dispose()
  }
})

test('a real wrapped viewport maps into an unmeasured new host and a changed incarnation refuses it', async ({
  server,
  client,
}) => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const f = await createSavedComparisonFixture(server.root, client)
  const editing = createEditorBufferSession(f.document.buffer)
  editing.setSelection(0, f.document.buffer.getTextSnapshot().length)
  editing.applyText(text)
  const lease = f.acquire()
  try {
    const read = lease.read()
    if (read.kind !== 'ready') throw new RangeError('Actual Saved read required')
    const attachment = savedDiffAttachment(read)
    const first = mountDiffProjectionControl(attachment)
    await waitFor(() => expect(first.snapshot().viewport.clientHeight).toBe(120))
    expect(first.editor.dispatchCommand('editor.action.toggleWordWrap')).toBe(true)
    expect(first.editor.isWordWrapEnabled()).toBe(true)
    first.editor.setSelection(first.offset(55) + 5)
    await waitFor(() =>
      expect(first.snapshot().visibleRows.some((row) => !row.firstWrapSegment)).toBe(true),
    )
    const key = diffAttachmentSubject(attachment).key
    const prior = first.presentation.views.get(key)!.anchors.viewport
    if (prior?.anchor.kind !== 'source')
      throw new RangeError('Measured wrapped source anchor required')
    expect(first.editor.getScrollPosition().top).toBeGreaterThan(0)
    first.binding.detach()
    first.editor.dispose()
    const moved = mountDiffProjectionControl(attachment, 'stacked', first.presentation)
    expect(moved.editor.isWordWrapEnabled()).toBe(false)
    await waitFor(() => expect(moved.snapshot().viewport.clientHeight).toBe(120))
    const next = moved.presentation.views.get(key)!.anchors.viewport
    expect(next?.anchor).toMatchObject({
      kind: 'source',
      side: prior.anchor.side,
      line: prior.anchor.line,
    })
    expect(next?.withinRow).toBe(prior.withinRow)
    moved.binding.detach()
    moved.editor.dispose()
    f.service.forceReplaceLiveDocument(f.saved)
    const replaced = f.service.getLiveDocument(f.document.key)!
    const nextEditing = createEditorBufferSession(replaced.buffer)
    nextEditing.setSelection(0, replaced.buffer.getTextSnapshot().length)
    nextEditing.applyText(text)
    const latest = lease.read()
    if (latest.kind !== 'ready') throw new RangeError('Actual replacement Saved read required')
    expect(latest.live.buffer).not.toBe(read.live.buffer)
    const fresh = mountDiffProjectionControl(
      savedDiffAttachment(latest),
      'stacked',
      moved.presentation,
    )
    await waitFor(() => expect(fresh.snapshot().viewport.clientHeight).toBe(120))
    expect(fresh.editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
    expect(fresh.editor.getSelections()[0]).toMatchObject({ anchorOffset: 0, headOffset: 0 })
  } finally {
    lease.release()
    f.service.dispose()
  }
})
