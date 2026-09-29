import { afterEach, expect, test, vi } from 'vitest'

import {
  createEditorLanguageFeatureToken,
  registerAmbientEditorPlugin,
  type EditorPlugin,
} from '../src/plugins'
import { createVisibleEditor } from './factories/visibleEditor'
import type { Editor } from '../src/editor/Editor'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
})

const DEMAND = createEditorLanguageFeatureToken<object>('test.ambientDemand')

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
