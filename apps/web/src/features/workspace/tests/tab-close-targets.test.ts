import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'
import { tabId } from '@/lib/documents/utils/identity'

import { editorTabCloseTargetIds } from '@/features/workspace/utils/tab-close-targets'

describe('editorTabCloseTargetIds', () => {
  it('targets the clicked tab for close', () => {
    expect(editorTabCloseTargetIds(editorTabs(), tabId('tab-b'), 'close')).toEqual(['tab-b'])
  })

  it('targets every tab except the clicked tab for close others', () => {
    expect(editorTabCloseTargetIds(editorTabs(), tabId('tab-b'), 'closeOthers')).toEqual([
      'tab-a',
      'tab-c',
      'tab-d',
    ])
  })

  it('targets tabs to the right of the clicked tab', () => {
    expect(editorTabCloseTargetIds(editorTabs(), tabId('tab-b'), 'closeToRight')).toEqual([
      'tab-c',
      'tab-d',
    ])
  })

  it('targets only clean tabs for close saved', () => {
    expect(editorTabCloseTargetIds(editorTabs(), tabId('tab-b'), 'closeSaved')).toEqual([
      'tab-a',
      'tab-c',
    ])
  })

  it('targets every tab for close all', () => {
    expect(editorTabCloseTargetIds(editorTabs(), tabId('tab-b'), 'closeAll')).toEqual([
      'tab-a',
      'tab-b',
      'tab-c',
      'tab-d',
    ])
  })

  it('returns no targets when the tab is missing', () => {
    expect(editorTabCloseTargetIds(editorTabs(), tabId('missing-tab'), 'closeAll')).toEqual([])
  })
})

function editorTabs() {
  return [
    { dirty: false, id: tabId('tab-a') },
    { dirty: true, id: tabId('tab-b') },
    { dirty: false, id: tabId('tab-c') },
    { dirty: true, id: tabId('tab-d') },
  ]
}
