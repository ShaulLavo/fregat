import { waitFor } from '@testing-library/react'
import { createTextDiff } from '@singapore-editor/diff'
import { TabPresentations } from '@/features/editor/state/tab-presentation'
import { tabId } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'
import {
  mountDiffProjectionControl,
  projectionControl,
} from '../../../../test/factories/diff-attachment'

test('restores a moved diff view before its old editor finishes disposal, and a copied tab keeps its own place', async () => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const text = Array.from({ length: 80 }, (_, index) => `const line${index} = ${index}`).join('\n')
  const attachment = projectionControl(
    createTextDiff({
      oldFile: { path: 'moving.ts', text: 'base' },
      newFile: { path: 'moving.ts', text },
    }),
  )
  const tabs = new TabPresentations()
  const id = tabId('moving-diff')
  const first = mountDiffProjectionControl(attachment, 'new', tabs.get(id).diffPanes.new)
  await waitFor(() => expect(first.snapshot().viewport.clientHeight).toBe(120))
  first.editor.setSelection(first.offset(40) + 6, first.offset(40) + 9, { reveal: false })
  first.editor.setScrollPosition({ top: 240, left: 2 })
  const position = first.editor.getScrollPosition()
  const selections = first.editor.getSelections()
  first.binding.detach()

  const second = mountDiffProjectionControl(attachment, 'new', tabs.get(id).diffPanes.new)
  first.editor.dispose()
  await waitFor(() => expect(second.snapshot().viewport.clientHeight).toBe(120))
  expect(second.editor.getScrollPosition()).toEqual(position)
  expect(second.editor.getSelections()).toEqual(selections)

  const copiedId = tabId('copied-diff')
  tabs.copy(id, copiedId)
  const original = tabs.get(id).diffPanes.new.views
  const saved = [...original.values()][0]!.anchors
  const copy = mountDiffProjectionControl(attachment, 'new', tabs.get(copiedId).diffPanes.new)
  await waitFor(() => expect(copy.snapshot().viewport.clientHeight).toBe(120))
  expect(copy.editor.getScrollPosition()).toEqual(position)
  copy.editor.setScrollPosition({ top: 40, left: 0 })
  copy.binding.detach()
  tabs.get(copiedId).regions.toggleRegion('context-row')
  expect([...original.values()][0]!.anchors).toBe(saved)
  expect(tabs.get(id).regions.isExpanded('context-row')).toBe(false)
})
