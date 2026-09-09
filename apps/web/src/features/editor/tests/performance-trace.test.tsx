import { editorPerformanceDomSnapshot } from '@/features/editor/state/performance-trace'
import { expect, test } from '../../../../test/fixtures'

test('DOM counters include the single native row owner during provisional paint', () => {
  const liveScroller = document.createElement('div')
  liveScroller.className = 'editor-virtualized'
  const liveRow = document.createElement('div')
  liveRow.className = 'editor-virtualized-row'
  liveRow.textContent = 'live'
  liveScroller.append(liveRow)

  liveScroller.dataset.editorPresentation = 'provisional'
  document.body.append(liveScroller)

  try {
    expect(editorPerformanceDomSnapshot(document)).toMatchObject({
      editorRows: 1,
      editorRowTextCharacters: 4,
      editorScrollers: 1,
    })
  } finally {
    liveScroller.remove()
  }
})
