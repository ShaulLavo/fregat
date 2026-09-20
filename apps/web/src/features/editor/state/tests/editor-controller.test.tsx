import { useEditor } from '@singapore-editor/react'

import { createEditorUiStore } from '@/features/editor/state/ui-state'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { tabId } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../../test/render'

test('keeps each mounted controller and ignores cleanup from a replaced view', () => {
  const rendered = renderHookWithProviders(() => ({
    left: useEditor(),
    right: useEditor(),
    replacement: useEditor(),
  }))
  const { left, right, replacement } = rendered.result.current
  const store = createEditorUiStore()
  const leftId = tabId('left')
  const rightId = tabId('right')
  const unregisterLeft = store.getState().registerEditorController(leftId, left)
  const unregisterRight = store.getState().registerEditorController(rightId, right)
  store.getState().setStatusBarSource({
    controller: right,
    filePath: '/repo/regions.ts',
    languageServerStatusSource: createEditorLanguageServerStatusSource(),
  })

  expect(store.getState().controllersByTabId.get(leftId)).toBe(left)
  expect(store.getState().controllersByTabId.get(rightId)).toBe(right)

  const unregisterReplacement = store.getState().registerEditorController(leftId, replacement)
  unregisterLeft()
  expect(store.getState().controllersByTabId.get(leftId)).toBe(replacement)
  expect(store.getState().statusBarSource?.controller).toBe(right)

  unregisterRight()
  expect(store.getState().controllersByTabId.has(rightId)).toBe(false)
  expect(store.getState().controllersByTabId.get(leftId)).toBe(replacement)
  unregisterReplacement()
  expect(store.getState().controllersByTabId.size).toBe(0)
})
