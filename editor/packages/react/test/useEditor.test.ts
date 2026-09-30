import { EditorTokenStore } from '@singapore-editor/core/syntax'
import {
  Editor,
  observeEditorMountTiming,
  type EditorHighlightResult,
} from '@singapore-editor/core/editor'
import type { EditorInitialPaintEvent, EditorPlugin } from '@singapore-editor/core/extensions'
import {
  createDocumentSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '@singapore-editor/core/document'
import type { EditorResolvedSelection } from '@singapore-editor/core/extensions'
import { act, createElement, StrictMode, useLayoutEffect, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EditorHost,
  useEditor,
  useEditorSelector,
  type ReactEditorController,
  type ReactEditorOptions,
  type ReactEditorStoreSnapshot,
} from '../src'

class MockHighlight extends Set<Range> {}

type MountedEditor = {
  readonly controller: ReactEditorController
  readonly host: HTMLElement
  render(options: ReactEditorOptions): void
  dispose(): void
}

type ActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

type Diagnostic = {
  readonly name: string
  readonly detail?: { readonly fullTextReads?: number }
}

type EditorCursor = {
  readonly column: number
  readonly row: number
}

type DiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: ((diagnostic: Diagnostic) => void) | null
}

const EMPTY_SELECTIONS: readonly EditorResolvedSelection[] = []

beforeEach(() => {
  ;(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true
  // @ts-expect-error happy-dom does not provide Highlight.
  globalThis.Highlight = MockHighlight
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'Highlight')
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.deleteProperty(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__')
  document.body.replaceChildren()
})

describe('useEditor', () => {
  it('mounts, initializes the store, and disposes with the React tree', () => {
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
    })

    expect(mounted.controller.getEditor()).not.toBeNull()
    expect(mounted.controller.materializeFullText()).toBe('alpha')
    expect(mounted.controller.getState()?.length).toBe(5)
    expect(viewText(mounted.controller)).toBe('alpha')

    mounted.dispose()

    expect(mounted.controller.getEditor()).toBeNull()
    expect(mounted.controller.getState()).toBeNull()
    expect(mounted.controller.getSnapshot()).toBeNull()
    expect(mounted.controller.materializeFullText()).toBe('')
  })

  it('forwards each initial paint phase once per generation through the latest callback', async () => {
    const firstEvents: EditorInitialPaintEvent[] = []
    const secondEvents: EditorInitialPaintEvent[] = []
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
      onInitialPaint: (event) => firstEvents.push(event),
    })
    await flushInitialPaintCallbacks()

    expect(firstEvents.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
    const firstGeneration = firstEvents[0]?.documentGeneration
    expect(new Set(firstEvents.map((event) => event.documentGeneration))).toEqual(
      new Set([firstGeneration]),
    )

    mounted.render({
      document: { text: 'beta', documentId: 'b.ts', revision: 1 },
      onInitialPaint: (event) => secondEvents.push(event),
    })
    await flushInitialPaintCallbacks()

    expect(firstEvents).toHaveLength(2)
    expect(secondEvents.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
    expect(secondEvents[0]?.documentGeneration).not.toBe(firstGeneration)
    expect(new Set(secondEvents.map((event) => event.documentGeneration))).toEqual(
      new Set([secondEvents[0]?.documentGeneration]),
    )

    mounted.dispose()
  })

  it('drops paint callbacks from the disposable StrictMode editor incarnation', async () => {
    const events: EditorInitialPaintEvent[] = []
    const mounted = mountReactEditor(
      {
        document: { text: 'alpha', documentId: 'strict.ts', revision: 1 },
        onInitialPaint: (event) => events.push(event),
      },
      true,
    )
    await flushInitialPaintCallbacks()

    expect(events.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
    expect(new Set(events.map((event) => event.documentGeneration)).size).toBe(1)

    mounted.dispose()
  })

  it('drops queued paint callbacks from earlier visits to the same target', async () => {
    const events: EditorInitialPaintEvent[] = []
    const options = {
      documentKey: 'a.ts',
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
      onInitialPaint: (event: EditorInitialPaintEvent) => events.push(event),
    }
    const mounted = mountReactEditor(options)
    const instance = mounted.controller.getEditor()

    mounted.render({
      ...options,
      documentKey: 'b.ts',
      document: { text: 'beta', documentId: 'b.ts', revision: 1 },
    })
    mounted.render(options)
    await flushInitialPaintCallbacks()

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(events.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
    expect(new Set(events.map((event) => event.documentGeneration)).size).toBe(1)
    expect(mounted.controller.materializeFullText()).toBe('alpha')
    mounted.dispose()
  })

  it('clears an outgoing target while the next document is unavailable without remounting', () => {
    const mounted = mountReactEditor({
      documentKey: 'a.ts',
      document: { text: 'alpha', documentId: 'a.ts' },
    })
    const instance = mounted.controller.getEditor()

    mounted.render({ documentKey: 'b.ts', document: null })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(mounted.controller.materializeFullText()).toBe('')

    mounted.render({
      documentKey: 'b.ts',
      document: { text: 'beta', documentId: 'b.ts' },
    })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(mounted.controller.materializeFullText()).toBe('beta')
    expect(mounted.controller.getState()?.documentId).toBe('b.ts')
    mounted.dispose()
  })

  it('treats an explicit missing target as a clear even if the document prop remains populated', () => {
    const document = { text: 'alpha', documentId: 'a.ts' }
    const mounted = mountReactEditor({ documentKey: 'a.ts', document })
    const instance = mounted.controller.getEditor()

    mounted.render({ documentKey: null, document })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(mounted.controller.materializeFullText()).toBe('')
    expect(mounted.controller.getState()?.documentId).toBeNull()

    mounted.render({ documentKey: 'a.ts', document })

    expect(mounted.controller.materializeFullText()).toBe('alpha')
    mounted.dispose()
  })

  it('keeps saved paint for initial null and replaces it with an authoritative empty file', () => {
    const snapshot = captureSavedPaint('saved text')
    const options = { documentKey: 'a.ts', document: null, snapshot }
    const mounted = mountSnapshotEditor(options)
    const instance = mounted.controller.getEditor()

    expect(instance?.getPresentationState()).toBe('provisional')
    expect(mounted.host.textContent).toContain('saved text')
    expect(mounted.controller.materializeFullText()).toBe('')
    expect(instance?.captureSnapshot()).toBeNull()

    mounted.render({ ...options })

    expect(instance?.getPresentationState()).toBe('provisional')
    expect(mounted.host.textContent).toContain('saved text')

    mounted.render({ ...options, document: { text: '', documentId: 'a.ts' } })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(instance?.getPresentationState()).toBe('live')
    expect(mounted.host.textContent).not.toContain('saved text')
    expect(mounted.controller.getState()?.documentId).toBe('a.ts')
    mounted.dispose()
  })

  it('applies a newly available theme before admitting paint in the same render', () => {
    const theme = { backgroundColor: '#112233', syntax: { keyword: '#445566' } }
    const snapshot = captureSavedPaint('saved text', { theme })
    const mounted = mountSnapshotEditor({ documentKey: 'a.ts', document: null })
    const instance = mounted.controller.getEditor()

    mounted.render({ documentKey: 'a.ts', document: null, snapshot, theme })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(instance?.getPresentationState()).toBe('provisional')
    expect(mounted.host.textContent).toContain('saved text')
    expect(mounted.controller.materializeFullText()).toBe('')
    mounted.dispose()
  })

  it('holds saved paint with the real document attached until highlighting completes', async () => {
    const snapshot = captureSavedPaint('saved text')
    const highlighting = delayedHighlighter()
    const presentations: ReturnType<Editor['getPresentationState']>[] = []
    const options = {
      documentKey: 'a.ts',
      document: { text: 'authoritative text', documentId: 'a.ts' },
      snapshot,
      plugins: [highlighting.plugin],
      onPresentationChange: (state: ReturnType<Editor['getPresentationState']>) =>
        presentations.push(state),
    }
    const mounted = mountSnapshotEditor(options)
    const instance = mounted.controller.getEditor()
    await flushInitialPaintCallbacks()

    expect(mounted.controller.materializeFullText()).toBe('authoritative text')
    expect(instance?.getPresentationState()).toBe('provisional')
    expect(mounted.host.textContent).toContain('saved text')
    expect(mounted.host.textContent).not.toContain('authoritative text')
    expect(mounted.controller.getSnapshot()).toBeNull()
    expect(instance?.captureSnapshot()).toBeNull()

    mounted.render({ ...options })
    await highlighting.release()
    await vi.waitFor(() => expect(instance?.getPresentationState()).toBe('live'))
    await flushInitialPaintCallbacks()

    expect(mounted.host.textContent).toContain('authoritative text')
    expect(mounted.host.textContent).not.toContain('saved text')
    expect(presentations.filter((state) => state === 'live')).toHaveLength(1)
    expect(instance?.captureSnapshot()).toMatchObject({
      documentKey: 'a.ts',
      documentId: 'a.ts',
      textVersion: mounted.controller.getSnapshot()?.textVersion,
    })

    mounted.render({ ...options, snapshot: captureSavedPaint('late saved text') })

    expect(instance?.getPresentationState()).toBe('live')
    expect(mounted.host.textContent).toContain('authoritative text')
    expect(mounted.host.textContent).not.toContain('late saved text')
    mounted.dispose()
  })

  it('withdraws a pending snapshot when eligibility becomes null', () => {
    const snapshot = captureSavedPaint('saved text')
    const mounted = mountSnapshotEditor({ documentKey: 'a.ts', document: null, snapshot })
    const instance = mounted.controller.getEditor()

    expect(instance?.getPresentationState()).toBe('provisional')

    mounted.render({ documentKey: 'a.ts', document: null, snapshot: null })

    expect(instance?.getPresentationState()).toBe('empty')
    expect(mounted.host.textContent).not.toContain('saved text')
    mounted.dispose()
  })

  it('reuses one editor through StrictMode replay and disposes it on true unmount', async () => {
    const mountDurations: number[] = []
    const dispose = vi.fn()
    const unsubscribe = observeEditorMountTiming((duration) => mountDurations.push(duration))
    const plugin: EditorPlugin = {
      activate: () => ({ dispose }),
    }
    const mounted = mountReactEditor(
      {
        document: { text: 'alpha', documentId: 'strict.ts', revision: 1 },
        plugins: [plugin],
      },
      true,
    )

    expect(mountDurations).toHaveLength(1)
    expect(dispose).not.toHaveBeenCalled()

    mounted.dispose()
    await flushInitialPaintCallbacks()

    expect(dispose).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('syncs state and last change after editor commands', () => {
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
    })

    act(() => mounted.controller.commands.edit({ from: 5, to: 5, text: '!' }))

    expect(mounted.controller.materializeFullText()).toBe('alpha!')
    expect(mounted.controller.getState()?.length).toBe(6)
    expect(mounted.controller.getLastChange()?.kind).toBe('edit')
    expect(viewText(mounted.controller)).toBe('alpha!')

    mounted.dispose()
  })

  it('does not materialize full text during store sync until text is read', () => {
    const diagnostics = collectDiagnostics()
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
    })
    diagnostics.length = 0

    act(() => mounted.controller.commands.edit({ from: 5, to: 5, text: '!' }))

    expect(textSnapshotReads(diagnostics)).toHaveLength(0)
    expect(mounted.controller.getTextSnapshot()?.length).toBe(6)
    expect(textSnapshotReads(diagnostics)).toHaveLength(0)
    expect(mounted.controller.materializeFullText()).toBe('alpha!')
    expect(textSnapshotReads(diagnostics)).toHaveLength(1)

    mounted.dispose()
  })

  it('never reads the whole text when store or view snapshots are spread or stringified', () => {
    const diagnostics = collectDiagnostics()
    const captured: { snapshot: ReactEditorStoreSnapshot | null } = { snapshot: null }
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    act(() => root.render(createElement(StoreProbeHarness, { captured })))
    const store = captured.snapshot
    if (!store) throw new Error('store probe did not render')
    diagnostics.length = 0

    const spread = { ...store, view: { ...store.snapshot } }
    JSON.stringify(store.snapshot)
    JSON.stringify(store.state)

    expect(spread.textSnapshot?.length).toBe(5)
    expect(fullTextReads(diagnostics)).toHaveLength(0)

    act(() => root.unmount())
    host.remove()
  })

  it('keeps useFullText current and stops reading once its subscriber unmounts', () => {
    const diagnostics = collectDiagnostics()
    let controller!: ReactEditorController
    const texts: string[] = []
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    const render = (withProbe: boolean): void =>
      act(() =>
        root.render(
          createElement(FullTextHarness, {
            withProbe,
            onController: (next: ReactEditorController) => {
              controller = next
            },
            onText: (text: string) => texts.push(text),
          }),
        ),
      )
    render(true)
    expect(texts.at(-1)).toBe('alpha')

    diagnostics.length = 0
    act(() => controller.commands.edit({ from: 5, to: 5, text: '!' }))
    expect(texts.at(-1)).toBe('alpha!')
    expect(fullTextReads(diagnostics)).toHaveLength(1)

    render(false)
    diagnostics.length = 0
    act(() => controller.commands.edit({ from: 6, to: 6, text: '?' }))
    expect(controller.materializeFullText()).toBe('alpha!?')
    expect(fullTextReads(diagnostics)).toHaveLength(1)

    act(() => root.unmount())
    host.remove()
  })

  it('syncs full view snapshots on selection updates', () => {
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
    })

    act(() =>
      mounted.controller.commands.setSelection(2, 2, {
        affinity: 'before',
        reveal: false,
      }),
    )

    expect(mounted.controller.getUpdateKind()).toBe('selection')
    expect(mounted.controller.getSnapshot()?.selections[0]).toMatchObject({
      affinity: 'before',
      anchorOffset: 2,
      headOffset: 2,
      startOffset: 2,
      endOffset: 2,
    })

    mounted.dispose()
  })

  it('syncs state cursor while dragging a mouse selection', () => {
    const cursors: (EditorCursor | null)[] = []
    let controller!: ReactEditorController
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)

    act(() => {
      root.render(
        createElement(DragCursorHarness, {
          onController: (nextController) => {
            controller = nextController
          },
          onCursor: (cursor) => cursors.push(cursor),
        }),
      )
    })

    try {
      const editor = editorElement(host)
      if (!editor) throw new Error('Missing editor element')

      mockEditorViewport(editor, 120, 40)
      act(() => {
        editor.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: 10,
            clientY: 10,
            detail: 1,
          }),
        )
      })
      act(() => {
        document.dispatchEvent(
          new MouseEvent('mousemove', { cancelable: true, clientX: 30, clientY: 10 }),
        )
      })

      expect(cursors.at(-1)).toEqual({ column: 3, row: 0 })
      expect(controller.getSnapshot()?.selections[0]).toMatchObject({
        anchorOffset: 1,
        headOffset: 3,
      })
    } finally {
      act(() => {
        document.dispatchEvent(
          new MouseEvent('mouseup', { cancelable: true, clientX: 30, clientY: 10 }),
        )
        root.unmount()
      })
      host.remove()
    }
  })

  it('can update selection without revealing it through commands', () => {
    const text = Array.from({ length: 80 }, (_value, index) => `line ${index}`).join('\n')
    const mounted = mountReactEditor({
      document: { text, documentId: 'long.txt', revision: 1 },
    })
    const editor = editorElement(mounted.host)
    expect(editor).not.toBeNull()
    mockEditorViewport(editor!, 80, 40, 2_000)

    act(() => mounted.controller.commands.setSelection(0))
    editor!.scrollTop = 0
    act(() => mounted.controller.commands.setSelection(text.length, text.length, { reveal: false }))

    expect(mounted.controller.getState()?.cursor).toEqual({ row: 79, column: 7 })
    expect(editor!.scrollTop).toBe(0)

    mounted.dispose()
  })

  it('can skip React store snapshot sync for lightweight editor hosts', () => {
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
      storeSync: 'none',
    })

    expect(mounted.controller.getEditor()).not.toBeNull()
    expect(mounted.controller.materializeFullText()).toBe('alpha')
    expect(mounted.controller.getSnapshot()).toBeNull()

    act(() => mounted.controller.commands.setSelection(1, 4))
    act(() => mounted.controller.commands.edit({ from: 5, to: 5, text: '!' }))

    expect(mounted.controller.materializeFullText()).toBe('alpha!')
    expect(mounted.controller.getState()?.length).toBe(6)
    expect(mounted.controller.getUpdateKind()).toBeNull()
    expect(mounted.controller.getSnapshot()).toBeNull()

    mounted.dispose()
  })

  it('does not clobber local edits until document identity or revision changes', () => {
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
    })

    act(() => mounted.controller.commands.edit({ from: 5, to: 5, text: '!' }))
    mounted.render({
      document: { text: 'server alpha', documentId: 'a.ts', revision: 1 },
    })

    expect(mounted.controller.materializeFullText()).toBe('alpha!')

    mounted.render({
      document: { text: 'server beta', documentId: 'a.ts', revision: 2 },
    })

    expect(mounted.controller.materializeFullText()).toBe('server beta')
    expect(mounted.controller.getSnapshot()?.documentId).toBe('a.ts')

    mounted.dispose()
  })

  it('incrementally syncs controlled generated document text without reopening', () => {
    const mounted = mountReactEditor({
      document: {
        documentId: 'generated:/a.ts',
        documentMode: 'static',
        languageId: 'typescript',
        revision: 'initial-hash',
        text: 'alpha',
        textSyncMode: 'incremental',
      },
    })
    const instance = mounted.controller.getEditor()
    expect(instance).not.toBeNull()
    const openSpy = vi.spyOn(instance as Editor, 'openDocument')
    const syncSpy = vi.spyOn(instance as Editor, 'syncText')

    mounted.render({
      document: {
        documentId: 'generated:/a.ts',
        documentMode: 'static',
        languageId: 'typescript',
        revision: 'next-hash',
        text: 'alpha beta',
        textSyncMode: 'incremental',
      },
    })

    expect(openSpy).not.toHaveBeenCalled()
    expect(syncSpy).toHaveBeenCalledWith(
      'alpha beta',
      expect.objectContaining({
        documentMode: 'static',
        languageId: 'typescript',
      }),
    )
    expect(mounted.controller.materializeFullText()).toBe('alpha beta')
    expect(mounted.controller.getLastChange()?.kind).toBe('edit')
    expect(mounted.controller.getState()).toMatchObject({
      documentId: 'generated:/a.ts',
      documentMode: 'static',
    })

    mounted.dispose()
  })

  it('reattaches cached document sessions with text and undo history intact', () => {
    const alphaSession = createDocumentSession('alpha')
    const betaSession = createDocumentSession('beta')
    const mounted = mountReactEditor({
      document: {
        documentId: 'a.ts',
        revision: 1,
        session: alphaSession,
        text: alphaSession.materializeFullText(),
      },
    })

    act(() => mounted.controller.commands.edit({ from: 5, to: 5, text: '!' }))

    expect(alphaSession.materializeFullText()).toBe('alpha!')
    expect(mounted.controller.getState()?.isDirty).toBe(true)

    mounted.render({
      document: {
        documentId: 'b.ts',
        revision: 1,
        session: betaSession,
        text: betaSession.materializeFullText(),
      },
    })
    mounted.render({
      document: {
        documentId: 'a.ts',
        revision: 1,
        session: alphaSession,
        text: alphaSession.materializeFullText(),
      },
    })

    expect(mounted.controller.materializeFullText()).toBe('alpha!')
    expect(mounted.controller.getState()?.canUndo).toBe(true)

    act(() => mounted.controller.commands.dispatchCommand('undo'))

    expect(mounted.controller.materializeFullText()).toBe('alpha')
    expect(mounted.controller.getState()?.isDirty).toBe(false)

    mounted.dispose()
  })

  it('keeps live document sessions attached across revision-only renders', () => {
    const session = createDocumentSession('alpha')
    const mounted = mountReactEditor({
      document: {
        documentId: 'a.ts',
        revision: 1,
        session,
        text: session.materializeFullText(),
      },
    })
    const instance = mounted.controller.getEditor()
    expect(instance).not.toBeNull()
    const attachSpy = vi.spyOn(instance as Editor, 'attachSession')

    mounted.render({
      document: {
        documentId: 'a.ts',
        revision: 2,
        session,
        text: 'stale prop text',
      },
    })

    expect(attachSpy).not.toHaveBeenCalled()
    expect(mounted.controller.materializeFullText()).toBe('alpha')

    mounted.dispose()
  })

  it('keeps live buffer sessions attached across buffer revision renders', () => {
    const buffer = createEditorTextBuffer('alpha')
    const view = createEditorViewSession(buffer)
    const mounted = mountReactEditor({
      document: {
        buffer,
        documentId: 'a.ts',
        text: buffer.materializeFullText(),
        view,
      },
    })
    const instance = mounted.controller.getEditor()
    expect(instance).not.toBeNull()
    const attachSpy = vi.spyOn(instance as Editor, 'attachSession')

    act(() => mounted.controller.commands.edit({ from: 5, to: 5, text: '!' }))
    mounted.render({
      document: {
        buffer,
        documentId: 'a.ts',
        text: buffer.materializeFullText(),
        view,
      },
    })

    expect(attachSpy).not.toHaveBeenCalled()
    expect(mounted.controller.materializeFullText()).toBe('alpha!')

    mounted.dispose()
  })

  it('keeps the attached document when the prepared highlighter theme tag changes', () => {
    const buffer = createEditorTextBuffer('const value = 1')
    const view = createEditorViewSession(buffer)
    const document = {
      buffer,
      view,
      text: buffer.materializeFullText(),
      documentId: 'theme.ts',
      languageId: 'typescript',
    }
    const mounted = mountReactEditor({
      document: { ...document, highlighterConfigurationTag: ['dark'] },
    })
    const instance = mounted.controller.getEditor()
    expect(instance).not.toBeNull()
    if (!instance) return
    const attach = vi.spyOn(instance, 'attachSession')
    mounted.render({ document: { ...document, highlighterConfigurationTag: ['light'] } })
    expect(attach).not.toHaveBeenCalled()
    expect(mounted.controller.materializeFullText()).toBe('const value = 1')
    mounted.dispose()
  })

  it('restores live buffer view scroll position without a reactive scroll prop', () => {
    const buffer = createEditorTextBuffer('alpha')
    const view = createEditorViewSession(buffer)
    view.setScrollPosition({ top: 18, left: 3 })

    const mounted = mountReactEditor({
      document: {
        buffer,
        documentId: 'a.ts',
        text: buffer.materializeFullText(),
        view,
      },
    })

    expect(mounted.controller.getEditor()?.getScrollPosition()).toEqual({ top: 18, left: 3 })

    mounted.dispose()
  })

  it('applies targeted reactive options without recreating the editor', () => {
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
      hiddenCharacters: 'hidden',
      scrollPosition: { top: 0, left: 0 },
      selection: { anchor: 0, head: 0 },
      theme: { backgroundColor: '#111111' },
    })
    const instance = mounted.controller.getEditor()

    expect(instance).not.toBeNull()

    const setHiddenSpy = vi.spyOn(instance as Editor, 'setHiddenCharacters')
    mounted.render({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
      hiddenCharacters: 'show',
      scrollPosition: { top: 12, left: 4 },
      selection: { affinity: 'before', anchor: 1, head: 3 },
      theme: { backgroundColor: '#222222' },
    })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(editorElement(mounted.host)?.style.getPropertyValue('--editor-background')).toBe(
      '#222222',
    )
    expect(setHiddenSpy).toHaveBeenCalledWith('show')
    expect(mounted.controller.getSnapshot()?.selections[0]).toMatchObject({
      affinity: 'before',
      anchorOffset: 1,
      headOffset: 3,
    })
    expect(instance?.getScrollPosition()).toEqual({ top: 12, left: 4 })

    mounted.dispose()
  })

  it('applies selection and explicit scroll after attaching the replacement document', () => {
    const mounted = mountReactEditor({
      document: { text: 'a', documentId: 'a.ts' },
      selection: { anchor: 0 },
      scrollPosition: { top: 0, left: 0 },
    })
    const instance = mounted.controller.getEditor()

    mounted.render({
      document: { text: 'alpha\nbravo\ncharlie', documentId: 'b.ts' },
      selection: { anchor: 12, head: 14, revealOffset: 14 },
      scrollPosition: { top: 12, left: 4 },
      theme: { backgroundColor: '#112233' },
    })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(mounted.controller.getSnapshot()?.selections[0]).toMatchObject({
      anchorOffset: 12,
      headOffset: 14,
    })
    expect(instance?.getScrollPosition()).toEqual({ top: 12, left: 4 })
    mounted.dispose()
  })

  it('applies keymap changes without recreating the editor', () => {
    const mounted = mountReactEditor({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
      keymap: { enabled: false },
    })
    const instance = mounted.controller.getEditor()

    expect(instance).not.toBeNull()

    const setKeymapSpy = vi.spyOn(instance as Editor, 'setKeymap')
    const keymap = {
      defaultBindings: false,
      layers: [],
    }

    mounted.render({
      document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
      keymap,
    })

    expect(mounted.controller.getEditor()).toBe(instance)
    expect(setKeymapSpy).toHaveBeenCalledWith(keymap)

    mounted.dispose()
  })

  it('does not resubmit constructor plugins on initial controlled sync', () => {
    const plugin = pluginFixture('probe')
    const nextPlugin = pluginFixture('next')
    const setPluginsSpy = vi.spyOn(Editor.prototype, 'setPlugins')
    let mounted: MountedEditor | null = null

    try {
      mounted = mountReactEditor({
        document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
        plugins: [plugin],
      })

      expect(setPluginsSpy).not.toHaveBeenCalled()

      mounted.render({
        document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
        plugins: [plugin],
      })

      expect(setPluginsSpy).not.toHaveBeenCalled()

      mounted.render({
        document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
        plugins: [nextPlugin],
      })

      expect(setPluginsSpy).toHaveBeenCalledTimes(1)
    } finally {
      mounted?.dispose()
      setPluginsSpy.mockRestore()
    }
  })

  it('exports a command facade that safely handles missing editor instances', () => {
    const mounted = mountReactEditor()
    const { controller } = mounted

    mounted.dispose()

    expect(controller.commands.dispatchCommand('selectAll')).toBe(false)
    expect(controller.commands.openFind()).toBe(false)
    expect(() => controller.commands.focus()).not.toThrow()
  })

  it('only rerenders selector subscribers whose selected value changes', () => {
    const renders = {
      text: 0,
      length: 0,
      selections: 0,
    }
    let controller!: ReactEditorController
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)

    act(() => {
      root.render(
        createElement(FineGrainedHarness, {
          onController: (nextController) => {
            controller = nextController
          },
          renders,
        }),
      )
    })

    const mountedRenders = { ...renders }

    act(() => controller.commands.setSelection(1, 4))

    expect(renders.text).toBe(mountedRenders.text)
    expect(renders.length).toBe(mountedRenders.length)
    expect(renders.selections).toBe(mountedRenders.selections + 1)

    const selectionRenders = { ...renders }

    act(() => controller.commands.edit({ from: 5, to: 5, text: '!' }))

    expect(renders.text).toBe(selectionRenders.text + 1)
    expect(renders.length).toBe(selectionRenders.length + 1)
    expect(renders.selections).toBe(selectionRenders.selections)

    act(() => root.unmount())
    host.remove()
  })
})

function ReactEditorHarness({
  options,
  onController,
}: {
  readonly options: ReactEditorOptions
  readonly onController: (controller: ReactEditorController) => void
}): ReactElement {
  const controller = useEditor(options)

  useLayoutEffect(() => {
    onController(controller)
  }, [controller, onController])

  return createElement(EditorHost, { controller })
}

function FineGrainedHarness({
  onController,
  renders,
}: {
  readonly onController: (controller: ReactEditorController) => void
  readonly renders: { text: number; length: number; selections: number }
}): ReactElement {
  const controller = useEditor({
    document: { text: 'alpha', documentId: 'a.ts', revision: 1 },
  })

  useLayoutEffect(() => {
    onController(controller)
  }, [controller, onController])

  return createElement(
    'div',
    null,
    createElement(EditorHost, { controller }),
    createElement(TextProbe, { controller, renders }),
    createElement(LengthProbe, { controller, renders }),
    createElement(SelectionProbe, { controller, renders }),
  )
}

function DragCursorHarness({
  onController,
  onCursor,
}: {
  readonly onController: (controller: ReactEditorController) => void
  readonly onCursor: (cursor: EditorCursor | null) => void
}): ReactElement {
  const controller = useEditor({
    document: { text: 'abcdef', documentId: 'a.ts', revision: 1 },
  })

  useLayoutEffect(() => {
    onController(controller)
  }, [controller, onController])

  return createElement(
    'div',
    null,
    createElement(EditorHost, { controller }),
    createElement(CursorProbe, { controller, onCursor }),
  )
}

function CursorProbe({
  controller,
  onCursor,
}: {
  readonly controller: ReactEditorController
  readonly onCursor: (cursor: EditorCursor | null) => void
}): null {
  const cursor = useEditorSelector(
    controller,
    (snapshot) => snapshot.state?.cursor ?? null,
    cursorsEqual,
  )

  useLayoutEffect(() => {
    onCursor(cursor)
  }, [cursor, onCursor])

  return null
}

function StoreProbeHarness({
  captured,
}: {
  readonly captured: { snapshot: ReactEditorStoreSnapshot | null }
}): ReactElement {
  const controller = useEditor({ document: { text: 'alpha', documentId: 'a.ts', revision: 1 } })
  captured.snapshot = useEditorSelector(controller, (snapshot) => snapshot)
  return createElement(EditorHost, { controller })
}

function FullTextHarness({
  withProbe,
  onController,
  onText,
}: {
  readonly withProbe: boolean
  readonly onController: (controller: ReactEditorController) => void
  readonly onText: (text: string) => void
}): ReactElement {
  const controller = useEditor({ document: { text: 'alpha', documentId: 'a.ts', revision: 1 } })

  useLayoutEffect(() => {
    onController(controller)
  }, [controller, onController])

  return createElement(
    'div',
    null,
    createElement(EditorHost, { controller }),
    withProbe ? createElement(FullTextProbe, { controller, onText }) : null,
  )
}

function FullTextProbe({
  controller,
  onText,
}: {
  readonly controller: ReactEditorController
  readonly onText: (text: string) => void
}): null {
  const text = controller.useFullText()
  useLayoutEffect(() => {
    onText(text)
  }, [text, onText])
  return null
}

function viewText(controller: ReactEditorController): string | undefined {
  const source = controller.getSnapshot()?.textSnapshot
  return source?.readRange(0, source.length)
}

function TextProbe({
  controller,
  renders,
}: {
  readonly controller: ReactEditorController
  readonly renders: { text: number }
}): null {
  renders.text += 1
  const text = controller.useFullText()
  void text
  return null
}

function LengthProbe({
  controller,
  renders,
}: {
  readonly controller: ReactEditorController
  readonly renders: { length: number }
}): null {
  renders.length += 1
  const length = useEditorSelector(controller, (snapshot) => snapshot.state?.length ?? 0)
  void length
  return null
}

function SelectionProbe({
  controller,
  renders,
}: {
  readonly controller: ReactEditorController
  readonly renders: { selections: number }
}): null {
  renders.selections += 1
  const selections = useEditorSelector(
    controller,
    (snapshot) => snapshot.snapshot?.selections ?? EMPTY_SELECTIONS,
    selectionsEqual,
  )
  void selections
  return null
}

function mountReactEditor(options: ReactEditorOptions = {}, strict = false): MountedEditor {
  let controller!: ReactEditorController
  const host = document.createElement('div')
  const root = createRoot(host)
  document.body.append(host)

  const render = (nextOptions: ReactEditorOptions): void => {
    act(() => {
      const harness = createElement(ReactEditorHarness, {
        options: nextOptions,
        onController: (nextController) => {
          controller = nextController
        },
      })
      root.render(strict ? createElement(StrictMode, null, harness) : harness)
    })
  }

  render(options)

  return {
    get controller() {
      return controller
    },
    host,
    render,
    dispose: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

async function flushInitialPaintCallbacks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

function mountSnapshotEditor(options: ReactEditorOptions): MountedEditor {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80)
  // Paint admission compares the outer box, which happy-dom otherwise reports as 0 by 0.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80)
  const mounted = mountReactEditor(options)
  const editor = mounted.controller.getEditor()
  const view: unknown = editor && Reflect.get(editor, 'view')
  if (
    view &&
    typeof view === 'object' &&
    'setScrollMetrics' in view &&
    typeof view.setScrollMetrics === 'function'
  ) {
    const measure = view.setScrollMetrics.bind(view)
    act(() => measure(0, 80, 320))
  }
  return mounted
}

function captureSavedPaint(text: string, options: ReactEditorOptions = {}): string {
  const mounted = mountSnapshotEditor({
    ...options,
    documentKey: 'a.ts',
    document: { text, documentId: 'a.ts' },
  })
  const capture = mounted.controller.getEditor()?.captureSnapshot()
  mounted.dispose()
  expect(capture).not.toBeNull()
  expect(capture?.paint).toBeTypeOf('string')
  return capture?.paint ?? ''
}

function delayedHighlighter() {
  let resolve!: (result: EditorHighlightResult) => void
  const completion = new Promise<EditorHighlightResult>((complete) => {
    resolve = complete
  })
  const session = {
    refresh: () => completion,
    applyChange: () => completion,
    dispose: () => undefined,
  }
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerHighlighter({
        createSession: () => session,
      }),
  }

  return {
    plugin,
    release: async () => {
      resolve({ tokens: EditorTokenStore.empty() })
      await completion
    },
  }
}

function editorElement(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.editor')
}

function mockEditorViewport(
  element: HTMLElement,
  width: number,
  height: number,
  scrollHeight = 200,
): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  })
}

function pluginFixture(name: string): EditorPlugin {
  return {
    name,
    activate: () => undefined,
  }
}

function cursorsEqual(left: EditorCursor | null, right: EditorCursor | null): boolean {
  if (left === right) return true
  if (!left || !right) return false

  return left.column === right.column && left.row === right.row
}

function selectionsEqual(
  current: readonly EditorResolvedSelection[],
  next: readonly EditorResolvedSelection[],
): boolean {
  if (current.length !== next.length) return false

  return current.every((selection, index) => {
    const nextSelection = next[index]
    if (!nextSelection) return false

    return (
      selection.anchorOffset === nextSelection.anchorOffset &&
      selection.headOffset === nextSelection.headOffset &&
      selection.startOffset === nextSelection.startOffset &&
      selection.endOffset === nextSelection.endOffset
    )
  })
}

function collectDiagnostics(): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  ;(globalThis as DiagnosticGlobal).__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

/** Whole-text reads of any kind: materialization, a full-range readRange, or a chunk walk. */
function fullTextReads(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.name === 'textSnapshot.read' && diagnostic.detail?.fullTextReads === 1,
  )
}

function textSnapshotReads(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.name === 'textSnapshot.materializeFullText')
}
