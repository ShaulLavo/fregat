import { EDITOR_OPTION_DESCRIPTORS, type EditorControlledOptionName } from '@singapore-editor/core'
import { Editor } from '@singapore-editor/core/editor'
import { act, createElement, useLayoutEffect, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorHost, useEditor, type ReactEditorController, type ReactEditorOptions } from '../src'

class MockHighlight extends Set<Range> {}

type MountedEditor = {
  readonly controller: ReactEditorController
  render(options: ReactEditorOptions): void
  remountHost(): void
  dispose(): void
}

type ActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

type OptionSample = {
  readonly initial: unknown
  readonly next: unknown
  readonly method: keyof Editor & string
  /** The whole argument list, because an option that arrives shifted or coerced is still broken. */
  readonly applied: readonly unknown[]
}

const DOCUMENT = { text: 'alpha beta', documentId: 'a.ts', revision: 1 }

/**
 * Host input paired with the editor call it has to produce, both spelled out here. An expectation
 * computed by running the option's own apply step would agree with whatever that step does,
 * including handing the editor a value no host asked for, so the numbers and objects below are the
 * only description of the contract. Keying by option name makes an option added without an entry a
 * compile error, and the suite walks the descriptor list so an option this binding never applies
 * fails here rather than in a host that notices months later.
 */
const OPTION_SAMPLES: Record<EditorControlledOptionName, OptionSample> = {
  detectIndentation: {
    initial: true,
    next: false,
    method: 'setDetectIndentation',
    applied: [false],
  },
  folding: { initial: true, next: false, method: 'setFolding', applied: [false] },
  editability: {
    initial: 'editable',
    next: 'readonly',
    method: 'setEditability',
    applied: ['readonly'],
  },
  fontFamily: {
    initial: 'monospace',
    next: 'JetBrains Mono, monospace',
    method: 'setFontFamily',
    applied: ['JetBrains Mono, monospace'],
  },
  fontSize: { initial: 13, next: 16, method: 'setFontSize', applied: [16] },
  gutterLeadingInset: { initial: 4, next: 12, method: 'setGutterLeadingInset', applied: [12] },
  gutterScroll: {
    initial: 'fixed',
    next: 'content',
    method: 'setGutterScroll',
    applied: ['content'],
  },
  hiddenCharacters: {
    initial: 'hidden',
    next: 'show',
    method: 'setHiddenCharacters',
    applied: ['show'],
  },
  keymap: {
    initial: { packs: [] },
    next: { packs: [], bindings: [] },
    method: 'setKeymap',
    applied: [{ packs: [], bindings: [] }],
  },
  lineHeight: { initial: 20, next: 34, method: 'setLineHeight', applied: [34] },
  rangeDecorations: {
    initial: [],
    next: [{ start: 0, end: 3, className: 'sample' }],
    method: 'setRangeDecorations',
    applied: [[{ start: 0, end: 3, className: 'sample' }]],
  },
  rowGap: { initial: 0, next: 6, method: 'setRowGap', applied: [6] },
  scrollMode: {
    initial: 'virtualized',
    next: 'static',
    method: 'setScrollMode',
    applied: ['static'],
  },
  scrollPosition: {
    initial: { top: 0, left: 0 },
    next: { top: 12, left: 4 },
    method: 'setScrollPosition',
    applied: [{ top: 12, left: 4 }],
  },
  selection: {
    initial: { anchor: 0, head: 0 },
    next: { affinity: 'before', anchor: 1, head: 3 },
    method: 'setSelection',
    applied: [
      1,
      3,
      {
        affinity: 'before',
        reveal: undefined,
        revealOffset: undefined,
      },
    ],
  },
  suspiciousCharacters: {
    initial: { ambiguous: true, invisible: true },
    next: { ambiguous: false, invisible: true },
    method: 'setSuspiciousCharacters',
    applied: [{ ambiguous: false, allowedCodePoints: [], allowedLocales: [], invisible: true }],
  },
  tabMovesFocus: {
    initial: false,
    next: true,
    method: 'setTabMovesFocus',
    applied: [true],
  },
  tabSize: { initial: 2, next: 8, method: 'setTabSize', applied: [8] },
  theme: {
    initial: { backgroundColor: '#111111' },
    next: { backgroundColor: '#222222' },
    method: 'setTheme',
    applied: [{ backgroundColor: '#222222' }],
  },
  wordWrap: { initial: true, next: false, method: 'setWordWrap', applied: [false] },
}

beforeEach(() => {
  ;(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true
  // @ts-expect-error happy-dom does not provide Highlight.
  globalThis.Highlight = MockHighlight
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'Highlight')
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  document.body.replaceChildren()
})

describe('controlled options', () => {
  for (const descriptor of EDITOR_OPTION_DESCRIPTORS) {
    it(`applies a changed ${descriptor.name} to the mounted editor`, () => {
      const sample = OPTION_SAMPLES[descriptor.name]
      const mounted = mountReactEditor(optionsWith(descriptor.name, sample.initial))
      const instance = mounted.controller.getEditor()
      expect(instance).not.toBeNull()
      const spy = vi.spyOn(
        instance as unknown as Record<string, (...args: unknown[]) => unknown>,
        sample.method,
      )

      mounted.render(optionsWith(descriptor.name, sample.next))

      expect(mounted.controller.getEditor()).toBe(instance)
      expect(spy.mock.calls).toContainEqual([...sample.applied])

      mounted.dispose()
    })
  }

  // A host element that unmounts and remounts keeps the same controller, so the tracker that
  // suppresses redundant setter calls has to forget the editor that went away with it.
  it('applies every option again to the editor a host remount creates', () => {
    const selection = OPTION_SAMPLES.selection
    const scrollPosition = OPTION_SAMPLES.scrollPosition
    const mounted = mountReactEditor({
      document: DOCUMENT,
      selection: selection.next,
      scrollPosition: scrollPosition.next,
    } as ReactEditorOptions)
    const first = mounted.controller.getEditor()
    expect(first).not.toBeNull()
    const selectionSpy = vi.spyOn(Editor.prototype, 'setSelection')
    const scrollSpy = vi.spyOn(Editor.prototype, 'setScrollPosition')

    mounted.remountHost()

    expect(mounted.controller.getEditor()).not.toBe(first)
    expect(selectionSpy.mock.calls).toContainEqual([...selection.applied])
    expect(scrollSpy.mock.calls).toContainEqual([...scrollPosition.applied])

    mounted.dispose()
  })

  it('leaves an unchanged selection and scroll position alone across renders', () => {
    const mounted = mountReactEditor({
      document: DOCUMENT,
      scrollPosition: { top: 12, left: 4 },
      selection: { anchor: 1, head: 3 },
    })
    const instance = mounted.controller.getEditor()
    expect(instance).not.toBeNull()
    const selectionSpy = vi.spyOn(instance as Editor, 'setSelection')
    const scrollSpy = vi.spyOn(instance as Editor, 'setScrollPosition')

    mounted.render({
      document: DOCUMENT,
      scrollPosition: { top: 12, left: 4 },
      selection: { anchor: 1, head: 3 },
    })

    expect(selectionSpy).not.toHaveBeenCalled()
    expect(scrollSpy).not.toHaveBeenCalled()

    mounted.dispose()
  })

  it('hands the flush gutter back when the host stops passing an inset', () => {
    const mounted = mountReactEditor(optionsWith('gutterLeadingInset', 12))
    const instance = mounted.controller.getEditor()
    expect(instance).not.toBeNull()
    const spy = vi.spyOn(instance as Editor, 'setGutterLeadingInset')

    mounted.render({ document: DOCUMENT })

    expect(spy.mock.calls).toEqual([[0]])

    mounted.dispose()
  })

  it('coerces input the editor cannot use to the descriptor default', () => {
    const rowGap = descriptorFor('rowGap')
    const scrollMode = descriptorFor('scrollMode')
    const selection = descriptorFor('selection')

    expect(rowGap.validate(Number.NaN)).toBe(rowGap.defaultValue)
    expect(rowGap.validate(-4)).toBe(rowGap.defaultValue)
    const inset = descriptorFor('gutterLeadingInset')
    expect(inset.validate(Number.NaN)).toBe(inset.defaultValue)
    expect(inset.validate(-12)).toBe(inset.defaultValue)
    expect(inset.validate(11.2)).toBe(12)
    expect(scrollMode.validate('sideways')).toBe(scrollMode.defaultValue)
    expect(selection.validate({ anchor: 'first' })).toBe(selection.defaultValue)
  })
})

function optionsWith(name: EditorControlledOptionName, value: unknown): ReactEditorOptions {
  return { document: DOCUMENT, [name]: value } as ReactEditorOptions
}

function descriptorFor(
  name: EditorControlledOptionName,
): (typeof EDITOR_OPTION_DESCRIPTORS)[number] {
  const descriptor = EDITOR_OPTION_DESCRIPTORS.find((entry) => entry.name === name)
  if (!descriptor) throw new Error(`Missing descriptor for ${name}`)

  return descriptor
}

function ReactEditorHarness({
  options,
  hostKey,
  onController,
}: {
  readonly options: ReactEditorOptions
  readonly hostKey: number
  readonly onController: (controller: ReactEditorController) => void
}): ReactElement {
  const controller = useEditor(options)

  useLayoutEffect(() => {
    onController(controller)
  }, [controller, onController])

  return createElement(EditorHost, { key: hostKey, controller })
}

function mountReactEditor(options: ReactEditorOptions): MountedEditor {
  let controller!: ReactEditorController
  let currentOptions = options
  let hostKey = 0
  const host = document.createElement('div')
  const root = createRoot(host)
  document.body.append(host)

  const commit = (): void => {
    act(() => {
      root.render(
        createElement(ReactEditorHarness, {
          options: currentOptions,
          hostKey,
          onController: (nextController) => {
            controller = nextController
          },
        }),
      )
    })
  }

  const render = (nextOptions: ReactEditorOptions): void => {
    currentOptions = nextOptions
    commit()
  }

  commit()

  return {
    get controller() {
      return controller
    },
    render,
    // A new key throws away the host element, which is what a host does when the editor moves in
    // the tree; the controller and its option tracker outlive it.
    remountHost: () => {
      hostKey += 1
      commit()
    },
    dispose: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}
