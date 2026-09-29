import { afterEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'
import { createModalEditingPlugin } from '../src/modal/modalPlugin'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress: (key: string) => Promise<void>
    proofType: (text: string) => Promise<void>
    proofImeComposition: (
      text: string,
      replacement?: readonly [number, number] | null,
    ) => Promise<void>
    proofInsertText: (text: string) => Promise<void>
  }
}

type Route = 'edit-context' | 'textarea'
const TEXT = 'one two three four five\nsix seven'
const editors: Editor[] = []
const hosts: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const host of hosts.splice(0)) host.remove()
})

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

async function open(route: Route, options: { readonly readonly?: boolean } = {}) {
  const host = document.createElement('div')
  host.style.cssText = 'width:600px;height:160px;display:flex'
  document.body.append(host)
  hosts.push(host)
  const editor = new Editor(host, {
    defaultText: TEXT,
    inputRoute: route,
    editability: options.readonly ? 'readonly' : 'editable',
    plugins: [createModalEditingPlugin()],
  })
  editors.push(editor)
  await frames()
  editor.focus()
  editor.setSelection(0, 0)
  await frames()
  return { editor, host }
}

async function keys(sequence: readonly string[]) {
  for (const key of sequence) await commands.proofKeyPress(key)
  await frames()
}

const textOf = (editor: Editor) => editor.materializeFullText()
const modeOf = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-modal-mode]')?.dataset.modalMode ?? host.dataset.modalMode

describe.each<Route>(['edit-context', 'textarea'])('modal editing on the %s route', (route) => {
  it('runs i, typing, Escape, 3w, dw and u, each as one step', async () => {
    const { editor } = await open(route)

    await keys(['i'])
    await commands.proofType('xy')
    await keys(['Escape', '3', 'w', 'd', 'w'])
    expect(textOf(editor)).toBe('xyone two three five\nsix seven')

    await keys(['u'])
    expect(textOf(editor)).toBe('xyone two three four five\nsix seven')
  })

  it('inserts no command letters and refuses text in normal mode', async () => {
    const { editor } = await open(route)

    await keys(['x', 'z', 'q', 'Enter'])
    await commands.proofInsertText('dictated')
    await frames()

    expect(textOf(editor)).toBe(TEXT)
  })

  it('composes in insert mode and refuses a composition committed in normal mode', async () => {
    const { editor } = await open(route)

    await keys(['i'])
    await commands.proofImeComposition('に')
    await commands.proofInsertText('日本')
    await frames()
    expect(textOf(editor)).toBe(`日本${TEXT}`)

    await keys(['Escape'])
    await commands.proofImeComposition('か')
    await commands.proofInsertText('漢')
    await frames()
    expect(textOf(editor)).toBe(`日本${TEXT}`)
  })

  it('drops a pending operator on Escape', async () => {
    const { editor } = await open(route)

    await keys(['d', 'Escape', 'w'])

    expect(textOf(editor)).toBe(TEXT)
    expect(editor.getState().cursor).toEqual({ row: 0, column: 4 })
  })

  it('moves but does not delete in a readonly view', async () => {
    const { editor } = await open(route, { readonly: true })

    await keys(['w', 'd', 'w', 'd', 'd'])

    expect(textOf(editor)).toBe(TEXT)
    expect(editor.getState().cursor).toEqual({ row: 0, column: 4 })
  })

  it('deletes a line and an inner word with counts', async () => {
    const { editor } = await open(route)

    await keys(['w', 'd', 'i', 'w'])
    expect(textOf(editor)).toBe('one  three four five\nsix seven')

    await keys(['d', 'd'])
    expect(textOf(editor)).toBe('six seven')
  })

  it('draws a block caret in normal mode and a line in insert mode', async () => {
    const { host } = await open(route)
    const scroll = host.querySelector<HTMLElement>('.editor-virtualized')!

    expect(scroll.dataset.editorCursorStyle).toBe('block')
    await keys(['i'])
    expect(scroll.dataset.editorCursorStyle).toBeUndefined()
  })
})

it('keeps each view of one document in its own mode', async () => {
  const buffer = createEditorTextBuffer(TEXT)
  const views = await Promise.all(
    [0, 1].map(async () => {
      const host = document.createElement('div')
      host.style.cssText = 'width:600px;height:120px;display:flex'
      document.body.append(host)
      hosts.push(host)
      const editor = new Editor(host, { plugins: [createModalEditingPlugin()] })
      editors.push(editor)
      editor.attachSession(createEditorBufferSession(buffer), { documentId: 'shared.txt' })
      return { editor, host }
    }),
  )
  await frames()
  views[0]!.editor.focus()
  views[0]!.editor.setSelection(0, 0)
  await frames()
  await keys(['i'])
  await commands.proofType('Z')
  await frames()

  expect(modeOf(views[0]!.host)).toBe('insert')
  expect(modeOf(views[1]!.host)).toBe('normal')
  expect([
    views[0]!.editor.materializeFullText().slice(0, 4),
    views[1]!.editor.materializeFullText().slice(0, 4),
  ]).toEqual(['Zone', 'Zone'])
})

it('gives typing back when the plugin goes', async () => {
  const { editor, host } = await open('textarea')
  editor.setPlugins([])
  editor.focus()
  await frames()

  await commands.proofType('x')
  await frames()

  expect(textOf(editor)).toBe(`x${TEXT}`)
  expect(host.querySelector<HTMLElement>('.editor-virtualized')!.dataset.editorCursorStyle).toBe(
    undefined,
  )
})
