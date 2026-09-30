import { afterEach, expect, test } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/public/document'
import '../src/style.css'

const editors: Editor[] = []
const hosts: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const host of hosts.splice(0)) host.remove()
})

test.each(['default text', 'attached session'] as const)(
  'renders %s before the first animation frame',
  async (mode) => {
    const host = document.createElement('div')
    host.style.cssText = 'width:600px;height:120px;display:flex'
    document.body.append(host)
    hosts.push(host)
    const text = 'const firstFrame = true;'
    const frame = new Promise<string>((resolve) => {
      requestAnimationFrame(() => {
        resolve(host.querySelector('[data-editor-virtual-row="0"]')?.textContent ?? '')
      })
    })
    const editor = new Editor(host, mode === 'default text' ? { defaultText: text } : {})
    editors.push(editor)
    if (mode === 'attached session') {
      editor.attachSession(createEditorBufferSession(createEditorTextBuffer(text)))
    }
    expect(await frame).toBe(text)
  },
)
