import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createChannel,
  createPlugin,
  derive,
  selectionInput,
  textInput,
  type EditorViewScope,
} from './createPlugin'
import { setHighlightRegistry } from './editor/runtime'
import type { EditorPlugin } from './plugins'
import { Editor } from './editor/Editor'

type TestWindow = Window & typeof globalThis

let restore: (() => void) | null = null
const editors: Editor[] = []

beforeEach(() => {
  const previous = { ...globalThis } as Record<string, unknown>
  const window = new Window() as unknown as TestWindow
  Object.assign(window, { SyntaxError })
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLDivElement: window.HTMLDivElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Node: window.Node,
    DOMRect: window.DOMRect,
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  })
  Object.defineProperty(globalThis, 'Highlight', {
    configurable: true,
    value: class Highlight extends Set<Range> {},
  })
  setHighlightRegistry({ set: () => undefined, delete: () => true } as never)
  restore = () => {
    setHighlightRegistry(undefined)
    for (const key of [
      'window',
      'document',
      'HTMLElement',
      'HTMLDivElement',
      'HTMLTextAreaElement',
    ]) {
      ;(globalThis as Record<string, unknown>)[key] = previous[key]
    }
  }
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  restore?.()
  restore = null
})

function createEditor(view: (scope: EditorViewScope) => void, text = 'alpha beta alpha'): Editor {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new Editor(container, {
    defaultText: text,
    plugins: [createPlugin({ name: 'test.scope', view })],
  })
  editors.push(editor)
  return editor
}

describe('createPlugin view scope', () => {
  test('watches an input once now and again only when its value changes', () => {
    const heads: (number | null)[] = []
    const head = derive([selectionInput], (selections) => selections[0]?.headOffset ?? null)
    const editor = createEditor((scope) => {
      scope.watch(head, (value) => heads.push(value))
    })
    const initial = heads.length

    editor.setSelection(3)
    editor.setSelection(3)
    editor.setSelection(5)

    expect(heads.slice(initial)).toEqual([3, 5])
  })

  test('a selection watcher hears nothing from a scroll or a token change', () => {
    let calls = 0
    const editor = createEditor((scope) => {
      scope.watch(selectionInput, () => void (calls += 1))
    })
    calls = 0

    editor.setScrollPosition({ top: 40 })
    expect(calls).toBe(0)
  })

  test('state notifies its watchers on set and stays quiet on the same value', () => {
    const seen: string[] = []
    let setMode: ((mode: string) => void) | null = null
    createEditor((scope) => {
      const mode = scope.state('normal')
      setMode = mode.set
      scope.watch(mode.input, (value) => seen.push(value))
    })

    setMode!('insert')
    setMode!('insert')

    expect(seen).toEqual(['normal', 'insert'])
  })

  test('handles a command for its own editor and releases it with the plugin', () => {
    let jumps = 0
    const editor = createEditor((scope) => {
      scope.handle('goToDefinition', () => {
        jumps += 1
        return true
      })
    })

    expect(editor.dispatchCommand('goToDefinition')).toBe(true)
    editor.setPlugins([])

    expect(editor.dispatchCommand('goToDefinition')).toBe(false)
    expect(jumps).toBe(1)
  })

  test('releases watchers, owned disposables and cleanups when the plugin goes', () => {
    const released: string[] = []
    let texts = 0
    const editor = createEditor((scope) => {
      scope.watch(textInput, () => void (texts += 1))
      scope.own({ dispose: () => released.push('own') })
      scope.onDispose(() => released.push('cleanup'))
    })
    editor.setPlugins([])
    texts = 0

    editor.edit({ from: 0, to: 0, text: 'x' })

    expect(released.toSorted()).toEqual(['cleanup', 'own'])
    expect(texts).toBe(0)
  })

  test('a command-only plugin is never updated by edits, selections or scrolls', () => {
    const counts = { updates: 0 }
    const editor = createEditor((scope) => {
      scope.handle('goToDefinition', () => true)
    })
    const contributions = Reflect.get(editor, 'viewContributions') as {
      readonly contributions: readonly { update: (...args: unknown[]) => void }[]
    }
    for (const contribution of contributions.contributions) {
      const update = contribution.update
      contribution.update = (...args) => {
        counts.updates += 1
        update(...args)
      }
    }

    editor.edit({ from: 0, to: 0, text: 'x' })
    editor.setSelection(2)
    editor.setScrollPosition({ top: 20 })

    expect(counts.updates).toBe(0)
  })

  test('two contributors and one consumer share an annotation channel in one editor', () => {
    const annotations = createChannel<string>('test.annotations', { kind: 'many' })
    const seen: (readonly string[])[] = []
    const lint = createPlugin({
      name: 'test.lint',
      view: (scope) => scope.provide(annotations, 'lint'),
    })
    const spell = createPlugin({
      name: 'test.spell',
      view: (scope) => {
        const word = scope.state('spell')
        scope.provide(annotations, word.input)
        setSpell = word.set
      },
    })
    let setSpell: ((value: string) => void) | null = null
    const gutter = createPlugin({
      name: 'test.gutter',
      view: (scope) => void scope.watch(annotations.input, (values) => seen.push(values)),
    })
    const editor = createEditorWith([gutter, lint, spell])

    expect(seen.at(-1)).toEqual(['lint', 'spell'])
    setSpell!('typo')
    expect(seen.at(-1)).toEqual(['lint', 'typo'])
    editor.setPlugins([gutter, spell])
    expect(seen.at(-1)).toEqual(['typo'])
  })

  test('refuses a second provider on a channel that takes one', () => {
    const owner = createChannel<string>('test.owner', { kind: 'one' })
    const seen: (string | null)[] = []
    const first = createPlugin({ name: 'test.a', view: (scope) => scope.provide(owner, 'a') })
    const second = createPlugin({ name: 'test.b', view: (scope) => scope.provide(owner, 'b') })
    const reader = createPlugin({
      name: 'test.owner-reader',
      view: (scope) => void scope.watch(owner.input, (value) => seen.push(value)),
    })
    createEditorWith([reader, first, second])

    expect(seen.at(-1)).toBe('a')
  })

  test('keeps channel values apart between editors', () => {
    const count = createChannel<number, number>('test.count', {
      kind: 'combine',
      combine: (values) => values.reduce((sum, value) => sum + value, 0),
    })
    const totals: number[] = []
    const provider = createPlugin({
      name: 'test.provider',
      view: (scope) => scope.provide(count, 1),
    })
    const reader = createPlugin({
      name: 'test.reader',
      view: (scope) => void scope.watch(count.input, (total) => totals.push(total)),
    })
    createEditorWith([provider, reader])
    createEditorWith([reader])

    expect(totals).toEqual([1, 0])
  })

  test('installs a used plugin once per editor and keeps it while any user remains', () => {
    let activations = 0
    let disposals = 0
    const shared: EditorPlugin = {
      name: 'test.shared',
      activate: () => {
        activations += 1
        return { dispose: () => void (disposals += 1) }
      },
    }
    const first = createPlugin({ name: 'test.first', uses: [shared] })
    const second = createPlugin({ name: 'test.second', uses: [shared] })
    const editor = createEditorWith([first, second])

    expect(activations).toBe(1)
    editor.setPlugins([second])
    expect(disposals).toBe(0)
    editor.setPlugins([])
    expect(disposals).toBe(1)
  })

  test('a contributed command dispatches in its own editor, lists, and goes with its plugin', () => {
    const align = { id: 'test.align.run', title: 'Align', mutates: true } as const
    const ran: string[] = []
    const plugin = (label: string) =>
      createPlugin({
        name: 'test.align',
        commands: [align],
        view: (scope) =>
          scope.handle(align, () => {
            ran.push(label)
            return true
          }),
      })
    const first = createEditorWith([plugin('first')])
    const second = createEditorWith([plugin('second')])

    expect(first.dispatchCommand('test.align.run')).toBe(true)
    expect(second.dispatchCommand('test.align.run')).toBe(true)
    expect(ran).toEqual(['first', 'second'])
    expect(first.getCommandDeclarations().some((entry) => entry.id === 'test.align.run')).toBe(true)

    first.setPlugins([])
    expect(first.dispatchCommand('test.align.run')).toBe(false)
    expect(first.getCommandDeclarations().some((entry) => entry.id === 'test.align.run')).toBe(
      false,
    )
  })

  test('refuses a command id outside the plugin namespace or naming a built-in', () => {
    const outside = { id: 'other.run', title: 'Run', mutates: false } as const
    const builtIn = { id: 'editor.action.rename', title: 'Rename', mutates: true } as const

    expect(() => createPlugin({ name: 'test.ns', commands: [outside] })).toThrow(/namespace/)
    expect(() => createPlugin({ name: 'editor.action', commands: [builtIn] })).toThrow(/namespace/)
  })

  test('a readonly editor refuses a contributed command that mutates', () => {
    let ran = 0
    const command = { id: 'test.write.go', title: 'Write', mutates: true } as const
    const plugin = createPlugin({
      name: 'test.write',
      commands: [command],
      view: (scope) => scope.handle(command, () => ((ran += 1), true)),
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      defaultText: 'alpha',
      editability: 'readonly',
      plugins: [plugin],
    })
    editors.push(editor)

    expect(editor.dispatchCommand('test.write.go')).toBe(false)
    expect(ran).toBe(0)
  })

  test('one contributed command invocation is one undo entry', () => {
    const upper = { id: 'test.upper.run', title: 'Upper', mutates: true } as const
    const plugin = createPlugin({
      name: 'test.upper',
      commands: [upper],
      view: (scope) =>
        scope.handle(upper, () => {
          scope.applyEdits([
            { from: 0, to: 1, text: 'A' },
            { from: 2, to: 3, text: 'P' },
          ])
          return true
        }),
    })
    const editor = createEditorWith([plugin])

    editor.dispatchCommand('test.upper.run')
    expect(editor.materializeFullText()).toBe('AlPha')
    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe('alpha')
  })
})

function createEditorWith(plugins: readonly EditorPlugin[]): Editor {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new Editor(container, { defaultText: 'alpha', plugins: [...plugins] })
  editors.push(editor)
  return editor
}
