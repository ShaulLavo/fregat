import { afterEach, expect, test, vi } from 'vitest'

import {
  createEditorLanguageFeatureToken,
  registerAmbientEditorPlugin,
  type EditorPlugin,
} from '../src/plugins'
import { createVisibleEditor } from './factories/visibleEditor'
import type { Editor } from '../src/editor/Editor'
import { createPlugin } from '../src/createPlugin'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
})

const DEMAND = createEditorLanguageFeatureToken<object>('test.ambientDemand')

test('ambient command ownership follows live provider demand', () => {
  const run = vi.fn(() => true)
  const registration = registerAmbientEditorPlugin({
    demand: DEMAND,
    load: () =>
      createPlugin({
        name: 'test.ambient',
        commands: [{ id: 'test.ambient.command', title: 'Run ambient command', mutates: false }],
        view: (scope) => scope.handle('test.ambient.command', run),
      }),
  })
  try {
    const editor = mount()
    editor.setText('alpha')
    editor.setKeymap({
      packs: [],
      bindings: [{ keys: 'Control+L', command: 'test.ambient.command' }],
    })
    const press = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'l',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      editor.getInputElement().dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(press()).toBe(false)
    const demand = editor.addPlugin(demanding())
    expect(press()).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    demand.dispose()
    expect(press()).toBe(false)
    expect(run).toHaveBeenCalledOnce()
  } finally {
    registration.dispose()
  }
})

/** A plugin that registers one provider for the demanded token while it is installed. */
function demanding(): EditorPlugin {
  return {
    name: 'test.demanding',
    activate: (context) =>
      context.registerCapabilityContribution({
        createContribution: (capabilities) =>
          capabilities.registerProvider(DEMAND, { language: '*' }, {}),
      }),
  }
}

function mount(plugins: readonly EditorPlugin[] = []): Editor {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, { plugins })
  editors.push(editor)
  return editor
}

test('an ambient plugin loads on first demand, is shared, and leaves with the last provider', async () => {
  const load = vi.fn()
  const activate = vi.fn()
  const dispose = vi.fn()
  const registration = registerAmbientEditorPlugin({
    demand: DEMAND,
    load: () => {
      load()
      return Promise.resolve({
        name: 'test.ambient',
        activate: () => {
          activate()
          return { dispose }
        },
      })
    },
  })
  try {
    const idle = mount()
    expect(load).not.toHaveBeenCalled()

    const wanting = mount([demanding()])
    await Promise.resolve()
    await Promise.resolve()
    expect(load).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledOnce()

    const alsoWanting = mount([demanding()])
    await Promise.resolve()
    await Promise.resolve()
    expect(load).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledTimes(2)

    wanting.setPlugins([])
    expect(dispose).toHaveBeenCalledOnce()
    idle.dispose()
    alsoWanting.dispose()
    editors.length = 0
    expect(dispose).toHaveBeenCalledTimes(2)
  } finally {
    registration.dispose()
  }
})

test('demand that goes away while the plugin is still loading installs nothing', async () => {
  let resolve!: (plugin: EditorPlugin) => void
  const activate = vi.fn()
  const registration = registerAmbientEditorPlugin({
    demand: DEMAND,
    load: () =>
      new Promise<EditorPlugin>((settle) => {
        resolve = settle
      }),
  })
  try {
    const editor = mount([demanding()])
    editor.setPlugins([])
    resolve({ name: 'test.ambient', activate })
    await Promise.resolve()
    await Promise.resolve()
    expect(activate).not.toHaveBeenCalled()
  } finally {
    registration.dispose()
  }
})

test('synchronous ambient view demand during construction mounts once', () => {
  const view = vi.fn()
  const dispose = vi.fn()
  const registration = registerAmbientEditorPlugin({
    demand: DEMAND,
    load: () =>
      createPlugin({
        name: 'test.ambient.initial-view',
        view: (scope) => {
          view()
          scope.onDispose(dispose)
        },
      }),
  })
  try {
    const editor = mount([demanding()])
    expect(view).toHaveBeenCalledOnce()
    editor.setPlugins([])
    expect(dispose).toHaveBeenCalledOnce()
  } finally {
    registration.dispose()
  }
})
