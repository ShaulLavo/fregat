import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/public/document'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress: (key: string) => Promise<void>
  }
}

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

test.each(['flex', 'grid'] as const)('fills a sized %s host after resizing', async (display) => {
  const host = document.createElement('div')
  host.style.cssText = `display:${display};width:600px;height:120px`
  document.body.append(host)
  hosts.push(host)
  const editor = new Editor(host, { defaultText: 'line\n'.repeat(1000), lineHeight: 20 })
  editors.push(editor)
  const scroll = host.querySelector<HTMLElement>('.editor-virtualized')!
  await expect.poll(() => scroll.clientHeight).toBe(120)
  expect(host.querySelectorAll('.editor-virtualized-row').length).toBeLessThan(100)
  host.style.height = '240px'
  await expect.poll(() => scroll.clientHeight).toBe(240)
  expect(host.querySelectorAll('.editor-virtualized-row').length).toBeLessThan(100)
})

test('keeps a 10 MiB document windowed while typing in a block host', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:block;width:600px;height:120px'
  document.body.append(host)
  hosts.push(host)
  const editor = new Editor(host, { lineHeight: 20 })
  editors.push(editor)
  const scroll = host.querySelector<HTMLElement>('.editor-virtualized')!
  const rows = () => host.querySelectorAll('.editor-virtualized-row').length

  // Catch an unconstrained viewport on a small document before the stress fixture allocates rows.
  editor.setText('line\n'.repeat(1000))
  await expect.poll(rows).toBeGreaterThan(0)
  expect(scroll.clientHeight).toBe(120)
  expect(rows()).toBeLessThan(100)

  const line = 'export const value: number = 123; // deterministic TypeScript fixture\n'
  const bytes = 10 * 1024 * 1024
  const text = line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes)
  editor.setText(text)
  await expect.poll(() => editor.getState().length).toBe(bytes)
  expect(scroll.clientHeight).toBe(120)
  expect(rows()).toBeLessThan(100)

  for (const where of ['end', 'middle'] as const) {
    const offset = where === 'end' ? editor.getState().length : Math.floor(bytes / 2)
    editor.setSelection(offset, offset, { reveal: true })
    editor.focus()
    const letter = where === 'end' ? 'q' : 'z'
    for (let key = 0; key < 20; key++) await commands.proofKeyPress(letter)
    expect(editor.getTextSnapshot().readRange(offset, offset + 20)).toBe(letter.repeat(20))
    await expect
      .poll(() =>
        host.querySelector('.editor-virtualized-content')?.textContent?.includes(letter.repeat(20)),
      )
      .toBe(true)
    expect(scroll.clientHeight).toBe(120)
    expect(rows()).toBeLessThan(100)
  }
})
