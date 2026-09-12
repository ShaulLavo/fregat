import { Editor } from '@singapor/core'
import { createMinimapPlugin } from '@singapor/minimap'
import { onTestFinished, vi } from 'vitest'
import { expect, test } from '../fixtures'
import { stubHighlightApi } from './highlight-api'

test('the DOM environment keeps a real editor usable without transferable minimap canvases', () => {
  stubHighlightApi()
  const worker = vi.spyOn(globalThis, 'Worker')
  onTestFinished(() => worker.mockRestore())
  const container = document.createElement('section')
  document.body.append(container)
  const editor = new Editor(container, {
    defaultText: 'const ready = true',
    plugins: [createMinimapPlugin({ enabled: true })],
  })
  try {
    expect(editor.materializeFullText()).toBe('const ready = true')
    expect(worker.mock.calls.length).toBe(0)
  } finally {
    editor.dispose()
    container.remove()
  }
})
