import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { createEditorFindPlugin } from '../../find/src/plugin'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofPointerDrag(start: { x: number; y: number }, end: { x: number; y: number }): Promise<void>
  }
}

it('records one pointer jump, survives an edit, and binds Alt+Left and Alt+Right', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:180px'
  document.body.append(host)
  const editor = new Editor(host, { defaultText: 'alpha beta gamma\nsecond destination' })
  try {
    editor.setSelection(1)
    const row = host.querySelector<HTMLElement>('[data-editor-virtual-row="1"]')!
    const rect = row.getBoundingClientRect()
    await commands.proofPointerDrag(
      { x: rect.left + 20, y: rect.top + 5 },
      { x: rect.left + 90, y: rect.top + 5 },
    )
    expect(editor.getState().cursor.row).toBe(1)
    editor.edit({ from: 0, to: 0, text: 'prefix ' })
    const destination = editor.getState().cursor
    await commands.proofKeyPress('Alt+ArrowLeft')
    expect(editor.getState().cursor).toMatchObject({ row: 0, column: 8 })
    expect(editor.jumpBack()).toBe(false)
    await commands.proofKeyPress('Alt+ArrowRight')
    expect(editor.getState().cursor).toMatchObject(destination)
    await commands.proofKeyPress('ArrowRight')
    expect(editor.jumpBack()).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ row: 0, column: 8 })
  } finally {
    editor.dispose()
    host.remove()
  }
})

it('records Find navigation on the simple editor path', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:180px'
  document.body.append(host)
  const editor = new Editor(host, {
    defaultText: 'alpha beta alpha',
    plugins: [createEditorFindPlugin()],
  })
  try {
    editor.setSelection(0, 5)
    editor.openFind()
    expect(editor.findNext()).toBe(true)
    editor.closeFind()
    expect(editor.jumpBack()).toBe(true)
    expect(editor.getState().cursor.column).toBe(5)
  } finally {
    editor.dispose()
    host.remove()
  }
})

it('restores the viewport anchor after inserting lines above a jump origin', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:180px'
  document.body.append(host)
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  const editor = new Editor(host, { defaultText: text })
  try {
    editor.focus()
    editor.setSelection(text.indexOf('line 20'))
    editor.setScrollPosition({ top: 300, left: 0 })
    const before = editor.getScrollPosition().top
    editor.jumpTo(text.indexOf('line 80'), undefined, 'go-to-line')
    editor.edit({ from: 0, to: 0, text: 'inserted\n' })
    expect(editor.jumpBack()).toBe(true)
    expect(editor.getScrollPosition().top).toBeGreaterThan(before)
    expect(editor.getScrollPosition().top - before).toBeLessThan(40)
    expect(host.contains(document.activeElement)).toBe(true)
    expect(editor.getState().cursor.row).toBe(21)
  } finally {
    editor.dispose()
    host.remove()
  }
})

it('restores the revealed destination viewport between successive jumps', () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:180px'
  document.body.append(host)
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  const editor = new Editor(host, { defaultText: text })
  editor.setSelection(1)
  editor.jumpTo(text.indexOf('line 50'))
  const destinationScroll = editor.getScrollPosition().top
  expect(destinationScroll).toBeGreaterThan(100)
  editor.jumpTo(text.indexOf('line 90'))
  expect(editor.jumpBack()).toBe(true)
  expect(editor.getScrollPosition().top).toBe(destinationScroll)
  editor.dispose()
  host.remove()
})

it('records a click that collapses an existing selection', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:180px'
  document.body.append(host)
  const editor = new Editor(host, { defaultText: 'alpha beta gamma' })
  editor.setSelection(0, 10)
  const rect = host
    .querySelector<HTMLElement>('[data-editor-virtual-row="0"]')!
    .getBoundingClientRect()
  const point = { x: rect.left + 35, y: rect.top + 5 }
  await commands.proofPointerDrag(point, point)
  expect(editor.jumpBack()).toBe(true)
  expect(editor.getState().cursor.column).toBe(10)
  editor.dispose()
  host.remove()
})

it('prevents browser navigation with an empty trail and at both ends', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host, { defaultText: 'alpha beta gamma' })
  const observed: KeyboardEvent[] = []
  const observe = (event: KeyboardEvent) => {
    if (event.altKey && event.key.startsWith('Arrow')) observed.push(event)
  }
  document.addEventListener('keydown', observe, true)
  try {
    editor.setSelection(0)
    editor.focus()
    await commands.proofKeyPress('Alt+ArrowLeft')
    await commands.proofKeyPress('Alt+ArrowRight')
    editor.jumpTo(7)
    await commands.proofKeyPress('Alt+ArrowRight')
    await commands.proofKeyPress('Alt+ArrowLeft')
    await commands.proofKeyPress('Alt+ArrowLeft')
    expect(observed.map((event) => event.defaultPrevented)).toEqual([true, true, true, true, true])
    expect(editor.getState().cursor.column).toBe(0)
  } finally {
    document.removeEventListener('keydown', observe, true)
    editor.dispose()
    host.remove()
  }
})

it('records committed Find navigation without retaining query prefixes', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host, {
    defaultText: 'origin alphabet alphabet',
    plugins: [createEditorFindPlugin({ seedSearchStringFromSelection: 'never' })],
  })
  try {
    editor.openFind()
    await commands.proofType('alphabet')
    expect(editor.jumpBack()).toBe(false)
    const preview = editor.getState().cursor.column
    await commands.proofKeyPress('Enter')
    editor.closeFind()
    expect(editor.jumpBack()).toBe(true)
    expect(editor.getState().cursor.column).toBe(preview)
    expect(editor.jumpBack()).toBe(false)
    expect(editor.jumpForward()).toBe(true)
  } finally {
    editor.dispose()
    host.remove()
  }
})
