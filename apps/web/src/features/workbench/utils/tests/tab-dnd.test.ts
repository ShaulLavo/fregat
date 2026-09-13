import { tabId } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../../test/fixtures'

import { tabReorderIntent } from '@/features/workbench/utils/tab-dnd'

test('creates a reorder intent from active and over tab ids', () => {
  expect(tabReorderIntent(editorTabs(), 'tab-a', 'tab-c')).toEqual({
    tabId: 'tab-a',
    targetIndex: 2,
  })
})

test('ignores drops without a tab target', () => {
  expect(tabReorderIntent(editorTabs(), 'tab-a', null)).toBeNull()
  expect(tabReorderIntent(editorTabs(), 'tab-a', 'missing-tab')).toBeNull()
})

test('ignores no-op and unknown active tab drops', () => {
  expect(tabReorderIntent(editorTabs(), 'tab-a', 'tab-a')).toBeNull()
  expect(tabReorderIntent(editorTabs(), 'missing-tab', 'tab-a')).toBeNull()
})

function editorTabs() {
  return [{ id: tabId('tab-a') }, { id: tabId('tab-b') }, { id: tabId('tab-c') }]
}
