import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../../../test/render'
import { EditorDocumentStateContext } from '@/features/editor/state/document-state'
import { WorkspaceEditServiceContext } from '@/features/editor/providers/workspace-edit-context'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import '@workspace/ui/globals.css'
import '@singapore-editor/core/style.css'
import { expect, test } from 'vitest'
import { getClient } from '@/lib/client'
import { operationDiffAttachment } from '@/lib/diff-attachment'
import {
  WorkspaceEditPreviewDialog,
  workspaceEditPreviewIsPresented,
  updateWorkspaceEditPublications,
} from '@/features/editor/components/workspace-edit-preview-dialog'
import type {
  DiffPanePublicationEvent,
  DiffPanePublication,
} from '@/features/editor/state/tab-presentation'
import type { WorkspaceEditPreview } from '@/features/editor/state/workspace-edit-service'
import { mountDiffProjectionControl } from '../../../../test/factories/diff-attachment'
import { createWorkspaceTextComparison } from '../../../../test/factories/workspace-text-changes'

const path = 'repo/src/editor-tab-a.ts'

function publications(events: readonly DiffPanePublicationEvent[], preview: WorkspaceEditPreview) {
  const initial: readonly DiffPanePublication[] = []
  return events.reduce(
    (current, event) => updateWorkspaceEditPublications(current, event, preview),
    initial,
  )
}

test('actual native geometry publishes the captured source once and withdraws its exact installation', async () => {
  const fixture = await createWorkspaceTextComparison(getClient(), path)
  const attachment = operationDiffAttachment(fixture.read, fixture.file)
  if (!attachment) throw new RangeError('Actual operation attachment required')
  const events: DiffPanePublicationEvent[] = []
  const view = mountDiffProjectionControl(attachment, 'stacked', undefined, (event) =>
    events.push(event),
  )
  try {
    view.host.style.display = 'flex'
    view.host.style.overflow = 'hidden'
    view.host.style.width = '0px'
    view.host.style.height = '0px'
    await expect.poll(() => view.snapshot().viewport.clientHeight).toBe(0)
    expect(publications(events, fixture.preview)).toHaveLength(0)
    expect(
      workspaceEditPreviewIsPresented(
        fixture.preview,
        publications(events, fixture.preview),
        'stacked',
      ),
    ).toBe(false)
    view.host.style.width = '420px'
    view.host.style.height = '160px'
    await expect.poll(() => publications(events, fixture.preview).length).toBe(1)
    const current = publications(events, fixture.preview)[0]!
    expect(current.attachment).toBe(attachment)
    expect(current.editor).toBe(view.editor)
    expect(current.geometryCommitted).toBe(true)
    expect(current.viewportWidth).toBeGreaterThan(0)
    expect(current.viewportHeight).toBeGreaterThan(0)
    expect(current.visibleRowCount).toBeGreaterThan(0)
    expect(current.textVersion).toBe(view.snapshot().textVersion)
    expect(current.documentId).toBe(view.snapshot().documentId)
    expect(workspaceEditPreviewIsPresented(fixture.preview, [current], 'stacked')).toBe(true)
    const count = events.length
    view.publish({ ...attachment })
    view.editor.setSelection(1, 2)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(events).toHaveLength(count)
    expect(publications(events, fixture.preview)[0]).toBe(current)
    view.editor.syncText('a different installed document version', {
      documentMode: 'static',
      languageId: null,
      tokens: [],
    })
    await expect.poll(() => publications(events, fixture.preview).length).toBe(0)
    expect(events.at(-1)?.kind).toBe('withdrawn')
    expect(events.at(-1)?.publication).toBe(current)
    expect(publications(events, fixture.preview)).toHaveLength(0)
    expect(
      workspaceEditPreviewIsPresented(
        fixture.preview,
        publications(events, fixture.preview),
        'stacked',
      ),
    ).toBe(false)
    const withdrawnCount = events.length
    view.binding.detach()
    expect(events).toHaveLength(withdrawnCount)
  } finally {
    fixture.service.cancelPreview(fixture.operationId)
    await fixture.pending
  }
})

test('split admission requires both current sides and an old withdrawal cannot remove a newer editor', async () => {
  const fixture = await createWorkspaceTextComparison(getClient(), path)
  const attachment = operationDiffAttachment(fixture.read, fixture.file)
  if (!attachment) throw new RangeError('Actual operation attachment required')
  const events: DiffPanePublicationEvent[] = []
  const sink = (event: DiffPanePublicationEvent) => events.push(event)
  const old = mountDiffProjectionControl(attachment, 'old', undefined, sink)
  const next = mountDiffProjectionControl(attachment, 'new', undefined, sink)
  try {
    old.host.style.display = 'flex'
    next.host.style.display = 'flex'
    old.host.style.overflow = 'hidden'
    next.host.style.overflow = 'hidden'
    old.host.style.width = '420px'
    old.host.style.height = '160px'
    next.host.style.width = '0px'
    next.host.style.height = '0px'
    await expect.poll(() => publications(events, fixture.preview).length).toBe(1)
    const oldPublication = publications(events, fixture.preview)[0]!
    expect(oldPublication.side).toBe('old')
    expect(
      workspaceEditPreviewIsPresented(
        fixture.preview,
        publications(events, fixture.preview),
        'split',
      ),
    ).toBe(false)
    next.host.style.width = '420px'
    next.host.style.height = '160px'
    await expect.poll(() => publications(events, fixture.preview).length).toBe(2)
    expect(
      workspaceEditPreviewIsPresented(
        fixture.preview,
        publications(events, fixture.preview),
        'split',
      ),
    ).toBe(true)
    expect(
      workspaceEditPreviewIsPresented(
        fixture.preview,
        publications(events, fixture.preview),
        'stacked',
      ),
    ).toBe(false)
    const replacement = mountDiffProjectionControl(attachment, 'old', undefined, sink)
    replacement.host.style.display = 'flex'
    replacement.host.style.overflow = 'hidden'
    replacement.host.style.width = '420px'
    replacement.host.style.height = '160px'
    await expect
      .poll(() =>
        publications(events, fixture.preview).some((entry) => entry.editor === replacement.editor),
      )
      .toBe(true)
    const replacementPublication = publications(events, fixture.preview).find(
      (entry) => entry.editor === replacement.editor,
    )!
    old.binding.detach()
    expect(events.at(-1)?.kind).toBe('withdrawn')
    expect(events.at(-1)?.publication.editor).toBe(old.editor)
    expect(publications(events, fixture.preview)).toContain(replacementPublication)
    expect(
      workspaceEditPreviewIsPresented(
        fixture.preview,
        publications(events, fixture.preview),
        'split',
      ),
    ).toBe(true)
    expect(
      workspaceEditPreviewIsPresented(
        { ...fixture.preview, operationId: 'other-operation' },
        publications(events, fixture.preview),
        'split',
      ),
    ).toBe(false)
    replacement.binding.detach()
    expect(
      workspaceEditPreviewIsPresented(
        fixture.preview,
        publications(events, fixture.preview),
        'split',
      ),
    ).toBe(false)
  } finally {
    fixture.service.cancelPreview(fixture.operationId)
    await fixture.pending
  }
})

test('real dialog confirms only after the mounted current comparison has native geometry', async () => {
  resourceQueryClient.removeQueries({ queryKey: editorQueryKeys.previewDiffModule })
  const fixture = await createWorkspaceTextComparison(getClient(), path)
  const rendered = renderWithProviders(
    <EditorDocumentStateContext value={fixture.store}>
      <WorkspaceEditServiceContext value={fixture.service}>
        <WorkspaceEditPreviewDialog />
      </WorkspaceEditServiceContext>
    </EditorDocumentStateContext>,
  )
  try {
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Make these changes' })
    expect(resourceQueryClient.getQueryData(editorQueryKeys.previewDiffModule)).toBeUndefined()
    expect(button).toBeDisabled()
    button.click()
    expect(fixture.service.getSnapshot().phase).toBe('awaiting-confirmation')
    expect(fixture.document.buffer.materializeFullText()).toBe(
      fixture.input.old.materializeFullText(),
    )
    await expect.poll(() => button.disabled).toBe(false)
    expect(fixture.store.getState().snapshotComparisons.size).toBe(2)
    button.click()
    await expect(fixture.pending).resolves.toEqual({ status: 'applied' })
    expect(fixture.document.buffer.materializeFullText()).toBe(
      fixture.input.new.materializeFullText(),
    )
    await expect.poll(() => fixture.store.getState().snapshotComparisons.size).toBe(0)
  } finally {
    fixture.service.cancelPreview(fixture.operationId)
    await fixture.pending
    rendered.unmount()
  }
})
