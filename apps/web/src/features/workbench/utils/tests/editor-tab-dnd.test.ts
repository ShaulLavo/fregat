import { tabId } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../../test/fixtures'

import { editorTabReorderIntent } from '@/features/workbench/utils/editor-tab-dnd'

test('creates a reorder intent from active and over tab ids', () => {
  expect(editorTabReorderIntent(editorTabs(), 'tab-a', 'tab-c')).toEqual({
    tabId: 'tab-a',
    targetIndex: 2,
  })
})

test('ignores drops without a tab target', () => {
  expect(editorTabReorderIntent(editorTabs(), 'tab-a', null)).toBeNull()
  expect(editorTabReorderIntent(editorTabs(), 'tab-a', 'missing-tab')).toBeNull()
})

test('ignores no-op and unknown active tab drops', () => {
  expect(editorTabReorderIntent(editorTabs(), 'tab-a', 'tab-a')).toBeNull()
  expect(editorTabReorderIntent(editorTabs(), 'missing-tab', 'tab-a')).toBeNull()
})

function editorTabs() {
  return [{ id: tabId('tab-a') }, { id: tabId('tab-b') }, { id: tabId('tab-c') }]
}
