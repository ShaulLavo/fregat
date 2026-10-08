import { EDITOR_OPTION_DESCRIPTORS, type EditorControlledOptionName } from '@singapore-editor/core'
import { Editor, type EditorScrollPosition } from '@singapore-editor/core/editor'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import { createReaction, createRoot, createSignal, getListener, type Accessor } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEditor,
  type SolidEditorController,
  type SolidEditorOptions,
  type SolidEditorSelection,
} from '../src'

class MockHighlight extends Set<Range> {}

type MountedEditor = {
  readonly controller: SolidEditorController
  dispose(): void
}

type OptionSample = {
  readonly initial: unknown
  readonly next: unknown
  readonly method: keyof Editor & string
  readonly applied: readonly unknown[]
}

const DOCUMENT = { text: 'alpha beta', documentId: 'a.ts', revision: 1 }

/**
 * Values chosen so that nothing here can be produced by accident: each `applied` entry is the
 * literal argument list the editor must receive once the matching signal carries `next`. The
 * record is keyed by option name, so an option added without an entry is a compile error, and the
 * suite walks the descriptor list, so an option this binding never wires to a signal fails here.
 */
const OPTION_SAMPLES: Record<EditorControlledOptionName, OptionSample> = {
  detectIndentation: {
    initial: true,
    next: false,
    method: 'setDetectIndentation',
    applied: [false],
  },
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
  folding: { initial: true, next: false, method: 'setFolding', applied: [false] },
  fontSize: { initial: 12, next: 15, method: 'setFontSize', applied: [15] },
  gutterLeadingInset: { initial: 0, next: 12, method: 'setGutterLeadingInset', applied: [12] },
  gutterScroll: {
    initial: 'fixed',
    next: 'content',
    method: 'setGutterScroll',
    applied: ['content'],
  },
  hiddenCharacters: {
    initial: 'show-on-selection',
    next: 'hidden',
    method: 'setHiddenCharacters',
    applied: ['hidden'],
  },
  keymap: {
    initial: {},
    next: { packs: [] },
    method: 'setKeymap',
    applied: [{ packs: [] }],
  },
  lineHeight: { initial: 18, next: 36, method: 'setLineHeight', applied: [36] },
  rangeDecorations: {
    initial: [],
    next: [{ start: 2, end: 5, className: 'sample' }],
    method: 'setRangeDecorations',
    applied: [[{ start: 2, end: 5, className: 'sample' }]],
  },
  rowGap: { initial: 1, next: 9, method: 'setRowGap', applied: [9] },
  scrollMode: {
    initial: 'static',
    next: 'virtualized',
    method: 'setScrollMode',
    applied: ['virtualized'],
  },
  scrollPosition: {
    initial: { top: 3, left: 1 },
    next: { top: 30, left: 7 },
    method: 'setScrollPosition',
    applied: [{ top: 30, left: 7 }],
  },
  selection: {
    initial: { anchor: 0, head: 0 },
    next: { affinity: 'before', anchor: 2, head: 5 },
    method: 'setSelection',
    applied: [
      2,
      5,
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
    initial: { backgroundColor: '#101010' },
    next: { backgroundColor: '#303030' },
    method: 'setTheme',
    applied: [{ backgroundColor: '#303030' }],
  },
  wordWrap: { initial: false, next: true, method: 'setWordWrap', applied: [true] },
}

beforeEach(() => {
  // @ts-expect-error happy-dom does not provide Highlight.
  globalThis.Highlight = MockHighlight
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'Highlight')
})

describe('controlled options', () => {
  for (const descriptor of EDITOR_OPTION_DESCRIPTORS) {
    it(`applies a changed ${descriptor.name} to the mounted editor`, async () => {
      const sample = OPTION_SAMPLES[descriptor.name]
      let setValue!: (value: unknown) => void
      const mounted = mountInRoot(() => {
        const [value, nextValue] = createSignal<unknown>(sample.initial)
        setValue = (next) => nextValue(() => next)
        return createEditor(optionsWith(descriptor.name, value))
      })
      const instance = mounted.controller.editor()
      expect(instance).not.toBeNull()
      const spy = vi.spyOn(
        instance as unknown as Record<string, (...args: unknown[]) => unknown>,
        sample.method,
      )

      setValue(sample.next)
      await flushEffects()

      expect(mounted.controller.editor()).toBe(instance)
      expect(spy.mock.calls).toContainEqual([...sample.applied])

      mounted.dispose()
    })
  }

  // Deliberately uncast: the loop above reaches every option through a computed key, which types
  // as nothing in particular, so an option this type never re-declared as a reactive value still
  // passes it. Written out by name, an option left with its plain editor type stops compiling —
  // and a host that works around that by passing a plain value gets an effect with nothing to
  // track, so the option is applied once at mount and never again.
  it('accepts an accessor for every option, including those the editor types as plain values', async () => {
    const [wordWrap, setWordWrap] = createSignal(false)
    const mounted = mountInRoot(() =>
      createEditor({
        document: () => DOCUMENT,
        fontFamily: () => OPTION_SAMPLES.fontFamily.initial as string,
        fontSize: () => OPTION_SAMPLES.fontSize.initial as number,
        lineHeight: () => OPTION_SAMPLES.lineHeight.initial as number,
        suspiciousCharacters: () => ({ ambiguous: true, invisible: true }),
        tabMovesFocus: () => false,
        tabSize: () => OPTION_SAMPLES.tabSize.initial as number,
        wordWrap,
      }),
    )
    await flushEffects()
    const instance = mounted.controller.editor()
    expect(instance).not.toBeNull()
    const spy = vi.spyOn(instance as Editor, 'setWordWrap')

    setWordWrap(true)
    await flushEffects()

    expect(spy.mock.calls).toContainEqual([true])

    mounted.dispose()
  })

  it('applies every option again to the editor a second mount creates', async () => {
    const selection = OPTION_SAMPLES.selection
    const scrollPosition = OPTION_SAMPLES.scrollPosition
    const mounted = mountInRoot(() =>
      createEditor({
        document: () => DOCUMENT,
        selection: () => selection.next as SolidEditorSelection,
        scrollPosition: () => scrollPosition.next as EditorScrollPosition,
      }),
    )
    await flushEffects()
    const first = mounted.controller.editor()
    expect(first).not.toBeNull()
    const selectionSpy = vi.spyOn(Editor.prototype, 'setSelection')
    const scrollSpy = vi.spyOn(Editor.prototype, 'setScrollPosition')

    mounted.controller.element(document.createElement('div'))
    await flushEffects()

    expect(mounted.controller.editor()).not.toBe(first)
    expect(selectionSpy.mock.calls).toContainEqual([...selection.applied])
    expect(scrollSpy.mock.calls).toContainEqual([...scrollPosition.applied])

    mounted.dispose()
  })

  it('leaves the sources of the other options unread when one option changes', async () => {
    let rowGapReads = 0
    const rowGap: Accessor<number> = () => {
      rowGapReads += 1
      return OPTION_SAMPLES.rowGap.next as number
    }
    const [theme, setTheme] = createSignal<EditorTheme>(OPTION_SAMPLES.theme.initial as EditorTheme)
    const mounted = mountInRoot(() => createEditor({ document: () => DOCUMENT, rowGap, theme }))
    await flushEffects()
    const readsBeforeThemeChange = rowGapReads

    setTheme(() => OPTION_SAMPLES.theme.next as EditorTheme)
    await flushEffects()

    expect(rowGapReads).toBe(readsBeforeThemeChange)

    mounted.dispose()
  })

  // A host is free to mount from inside a computation. Reading the constructor options there would
  // subscribe that computation to them, and the next change to any of them would tear the editor
  // down and build a new one instead of updating the live one.
  it('reads the constructor options without subscribing the caller to them', () => {
    let listenerAtFirstRead: unknown = 'unread'
    const rowGap: Accessor<number> = () => {
      if (listenerAtFirstRead === 'unread') listenerAtFirstRead = getListener()
      return OPTION_SAMPLES.rowGap.next as number
    }
    let controller!: SolidEditorController
    let disposeRoot!: () => void

    createRoot((dispose) => {
      disposeRoot = dispose
      controller = createEditor({ document: () => DOCUMENT, rowGap })
      createReaction(() => undefined)(() => {
        controller.element(document.createElement('div'))
      })
    })

    expect(listenerAtFirstRead).toBeNull()

    controller.dispose()
    disposeRoot()
  })
})

function optionsWith(
  name: EditorControlledOptionName,
  value: Accessor<unknown>,
): SolidEditorOptions {
  return { document: () => DOCUMENT, [name]: value }
}

function mountInRoot(create: () => SolidEditorController): MountedEditor {
  let controller!: SolidEditorController
  let disposeRoot!: () => void
  const host = document.createElement('div')

  createRoot((dispose) => {
    disposeRoot = dispose
    controller = create()
    controller.element(host)
  })

  return {
    controller,
    dispose: disposeRoot,
  }
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
