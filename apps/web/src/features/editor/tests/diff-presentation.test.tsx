import { Editor } from '@singapore-editor/core'
import { createDiffPresentationBinding } from '@/features/editor/state/diff-presentation'
import { TabPresentations } from '@/features/editor/state/tab-presentation'
import { tabId } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'

test('restores a moved diff view before its old editor finishes disposal', () => {
  stubEditorViewport()
  stubHighlightApi()
  const tabs = new TabPresentations()
  const id = tabId('moving-diff')
  const presentation = tabs.get(id).diffPanes.new
  const before = createDiffPresentationBinding(presentation)
  const firstHost = document.createElement('div')
  const secondHost = document.createElement('div')
  document.body.append(firstHost, secondHost)
  const first = new Editor(firstHost, { plugins: [before.plugin] })
  first.setText('alpha\nbeta\ngamma\n')
  before.restore(first)
  first.setSelection(6, 9)
  first.setScrollPosition({ left: 2, top: 11 })
  const position = first.getScrollPosition()
  before.detach()

  const after = createDiffPresentationBinding(tabs.get(id).diffPanes.new)
  const second = new Editor(secondHost, { plugins: [after.plugin] })
  try {
    second.setText('alpha\nbeta\ngamma\n')
    after.restore(second)
    first.dispose()

    expect(second.getState().cursor).toEqual({ row: 1, column: 3 })
    expect(second.getScrollPosition()).toEqual(position)
    second.setSelection(1, 3)
    after.detach()
    expect(presentation.selections[0]).toMatchObject({ anchorOffset: 1, headOffset: 3 })
    const movedPosition = presentation.scroll

    const copiedId = tabId('copied-diff')
    tabs.copy(id, copiedId)
    const copy = tabs.get(copiedId)
    copy.diffPanes.new.scroll = { left: 0, top: 40 }
    copy.regions.toggleRegion('context-row')
    expect(presentation.scroll).toEqual(movedPosition)
    expect(tabs.get(id).regions.isExpanded('context-row')).toBe(false)
  } finally {
    first.dispose()
    second.dispose()
    firstHost.remove()
    secondHost.remove()
  }
})
