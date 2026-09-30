import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStringTextSnapshot } from '../src/documentTextSnapshot'
import { readAll } from './factories/snapshotText'

import { Editor } from '../src/editor'
import { InputSelectionController } from '../src/editor/inputSelectionController'
import { VirtualizedTextView } from '../src/virtualization'
import { resetEditorInstanceCount } from '../src/public/testing'
import {
  createDocumentSession,
  createEditorBufferSession,
  createEditorTextBuffer,
  type DocumentSessionChange,
} from '../src/public/document'
import type {
  EditorEditContributionContext,
  EditorPlugin,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
} from '../src/public/extensions'
import { resolveSelection } from '../src/selections'

// Non-ASCII forces the measured geometry path, where a row is measured one
// grapheme at a time against its own rect.
const MEASURED_ROW_TEXT = 'ünïcödé rôw'
const MEASURED_ROW_GRAPHEMES = 11

function createViewContributionPlugin(kinds: EditorViewContributionUpdateKind[]): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (_snapshot, kind) => {
            kinds.push(kind)
          },
          dispose: () => {},
        }),
      }),
  }
}

type ViewContributionContextCapture = {
  context: EditorViewContributionContext | null
}

type EditContributionContextCapture = {
  context: EditorEditContributionContext | null
}

const EMPTY_VIEW_CONTRIBUTION = { dispose: noop, update: noop }

function noop(): void {}

function captureViewContributionPlugin(capture: ViewContributionContextCapture): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (contributionContext) => {
          capture.context = contributionContext
          return EMPTY_VIEW_CONTRIBUTION
        },
      }),
  }
}

function captureEditContributionPlugin(capture: EditContributionContextCapture): EditorPlugin {
  return {
    activate: (context) =>
      context.registerEditContribution({
        createContribution: (contributionContext) => {
          capture.context = contributionContext
          return EMPTY_VIEW_CONTRIBUTION
        },
      }),
  }
}

function requireViewContributionContext(
  context: EditorViewContributionContext | null,
): EditorViewContributionContext {
  if (!context) throw new Error('plugin received no contribution context')
  return context
}

function requireEditContributionContext(
  context: EditorEditContributionContext | null,
): EditorEditContributionContext {
  if (!context) throw new Error('plugin received no edit contribution context')
  return context
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  } as DOMRect
}

/**
 * Layout is inert here, so every rect would come back empty and the measured
 * geometry path would bail before it ever asks a row where it is.
 */
function stubLayout(): (element: Element) => number {
  const glyph = rect(0, 0, 8, 16)
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(
    () => ({ item: () => glyph, length: 1 }) as unknown as DOMRectList,
  )

  const reads = new Map<Element, number>()
  const box = rect(0, 0, 400, 400)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    reads.set(this, (reads.get(this) ?? 0) + 1)
    return box
  })
  return (element) => reads.get(element) ?? 0
}

function mountMeasuredRowView(host: HTMLElement): VirtualizedTextView {
  const viewContainer = document.createElement('div')
  host.appendChild(viewContainer)
  const view = new VirtualizedTextView(viewContainer, { overscan: 0, rowHeight: 20 })
  view.setText(MEASURED_ROW_TEXT)
  view.setScrollMetrics(0, 40)
  return view
}

function mountedRowElement(view: VirtualizedTextView): HTMLElement {
  const row = view.getState().mountedRows[0]
  if (!row) throw new Error('no mounted row')
  return row.element
}

/** Retires the cached row geometry so the next probe measures the row again. */
function rebuildRowGeometry(
  view: VirtualizedTextView,
  readsFor: (element: Element) => number,
): { readonly element: HTMLElement; readonly reads: number } {
  view.setText(`${MEASURED_ROW_TEXT} `)
  const element = mountedRowElement(view)
  return { element, reads: readsFor(element) }
}

function createChangeRecordingPlugin(
  edits: (readonly { readonly from: number; readonly to: number; readonly text: string }[])[],
): EditorPlugin {
  return {
    activate: (context) =>
      context.registerDecorationContribution({
        createContribution: () => ({
          handleEditorChange: (change) => {
            if (change) edits.push(change.edits)
          },
          dispose: () => undefined,
        }),
      }),
  }
}

describe('editor operations', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    vi.restoreAllMocks()
  })

  it('reveals, syncs the DOM selection and notifies once for a whole pass', () => {
    const kinds: EditorViewContributionUpdateKind[] = []
    const changes: unknown[] = []
    editor = new Editor(container, {
      defaultText: 'abc',
      onChange: (_state, change) => {
        if (change) changes.push(change)
      },
      plugins: [createViewContributionPlugin(kinds)],
    })
    const reveal = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const sync = vi.spyOn(InputSelectionController.prototype, 'syncDomSelection')
    kinds.length = 0

    editor.runInOperation(() => {
      editor.edit({ from: 0, to: 0, text: 'x' })
      editor.edit({ from: 1, to: 1, text: 'y' })
      editor.setSelection(2, 2)
    })

    expect(editor.materializeFullText()).toBe('xyabc')
    expect(changes).toHaveLength(1)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(kinds.filter((kind) => kind === 'content')).toHaveLength(1)
    // A caret move is the last change of the pass but not its widest one.
    expect(kinds.at(-1)).toBe('content')
  })

  it('hands listeners the end of the pass, not the first change in it', () => {
    const changes: DocumentSessionChange[] = []
    editor = new Editor(container, {
      defaultText: 'abc',
      onChange: (_state, change) => {
        if (change) changes.push(change)
      },
    })

    editor.runInOperation(() => {
      editor.edit({ from: 0, to: 0, text: 'x' })
      editor.edit({ from: 1, to: 1, text: 'y' })
      editor.setSelection(2, 2)
    })

    const notified = changes.at(-1)
    // Anything short of the whole pass describes a document that is already two
    // changes out of date by the time it is handed over.
    expect(editor.materializeFullText()).toBe('xyabc')
    expect(notified?.textSnapshot.materializeFullText()).toBe(editor.materializeFullText())
  })

  it('leaves the DOM selection alone for a pass whose changes all opted out', () => {
    editor = new Editor(container, { defaultText: 'abc' })
    const sync = vi.spyOn(InputSelectionController.prototype, 'syncDomSelection')

    editor.setSelection(1, 1)

    expect(editor.getState().cursor).toMatchObject({ column: 1, row: 0 })
    expect(sync).not.toHaveBeenCalled()
  })

  it('keeps the reveal an earlier change asked for when a later one asks for none', () => {
    editor = new Editor(container, { defaultText: 'abcdefgh' })
    const reveal = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')

    editor.runInOperation(() => {
      editor.setSelection(5, 5)
      editor.edit({ from: 0, to: 0, text: 'x' })
    })

    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledWith(5, 'after', undefined)
  })

  it('round-trips public selection affinity while retaining public reveal defaults', () => {
    const session = createDocumentSession('abc')
    editor = new Editor(container)
    editor.attachSession(session)
    const revealCaret = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const revealOffset = vi.spyOn(VirtualizedTextView.prototype, 'revealOffset')

    editor.setSelection(1, 1, { affinity: 'before' })

    const selection = session.getSelections().selections[0]
    if (!selection) throw new Error('setSelection left no selection')
    expect(resolveSelection(session.getSnapshot(), selection).affinity).toBe('before')
    expect(revealCaret).toHaveBeenCalledWith(1, 'before', undefined)
    expect(revealOffset).not.toHaveBeenCalled()
  })

  it('adopts applyEdit tokens on the buffer session it edited', () => {
    const capture: ViewContributionContextCapture = { context: null }
    editor = new Editor(container, { plugins: [captureViewContributionPlugin(capture)] })
    editor.attachSession(createEditorBufferSession(createEditorTextBuffer('abc')))
    const context = requireViewContributionContext(capture.context)

    editor.applyEdit(
      { from: 0, to: 1, text: 'X' },
      [{ start: 0, end: 3, style: { color: 'red' } }],
      createStringTextSnapshot('Xbc'),
    )

    expect(readAll(context.getSnapshot().textSnapshot)).toBe('Xbc')
    expect(context.getSnapshot().tokens.length).toBe(1)
  })

  it('adopts applyEdit tokens for the edited document, not one a change listener opens', () => {
    const capture: ViewContributionContextCapture = { context: null }
    let reopened = false
    editor = new Editor(container, {
      plugins: [captureViewContributionPlugin(capture)],
      onChange: (_state, change) => {
        if (reopened || change?.kind !== 'edit') return
        reopened = true
        editor.openDocument({ documentId: 'other.ts', text: 'other' })
      },
    })
    editor.attachSession(createEditorBufferSession(createEditorTextBuffer('abc')))
    const context = requireViewContributionContext(capture.context)

    editor.applyEdit(
      { from: 0, to: 1, text: 'X' },
      [{ start: 0, end: 3, style: { color: 'red' } }],
      createStringTextSnapshot('Xbc'),
    )

    expect(reopened).toBe(true)
    expect(readAll(context.getSnapshot().textSnapshot)).toBe('other')
    expect(context.getSnapshot().tokens.length).toBe(0)
  })

  it('round-trips affinity through an explicit post-edit selection', () => {
    const session = createDocumentSession('abc')
    editor = new Editor(container)
    editor.attachSession(session)

    editor.edit({ from: 1, text: 'B', to: 2 }, { selection: { affinity: 'before', anchor: 2 } })

    const selection = session.getSelections().selections[0]
    if (!selection) throw new Error('edit left no selection')
    expect(resolveSelection(session.getSnapshot(), selection)).toMatchObject({
      affinity: 'before',
      headOffset: 2,
    })
  })

  it('keeps contribution selection reveal opt-in and lets an explicit target win', () => {
    const capture: ViewContributionContextCapture = { context: null }
    const plugin = captureViewContributionPlugin(capture)
    editor = new Editor(container, { defaultText: 'abc', plugins: [plugin] })
    const revealCaret = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const revealOffset = vi.spyOn(VirtualizedTextView.prototype, 'revealOffset')
    const context = requireViewContributionContext(capture.context)

    context.setSelection(1, 1, 'test.affinity', { affinity: 'before' })

    expect(context.getSnapshot().selections[0]).toMatchObject({
      affinity: 'before',
      headOffset: 1,
    })
    expect(revealCaret).not.toHaveBeenCalled()
    expect(revealOffset).not.toHaveBeenCalled()

    context.setSelection(2, 2, 'test.reveal', { reveal: true })
    expect(revealCaret).toHaveBeenLastCalledWith(2, 'after', undefined)
    expect(revealOffset).not.toHaveBeenCalled()

    revealCaret.mockClear()
    context.setSelection(1, 1, 'test.explicitHeadReveal', {
      affinity: 'before',
      revealOffset: 1,
    })
    expect(revealCaret).toHaveBeenLastCalledWith(1, 'before', undefined)
    expect(revealOffset).not.toHaveBeenCalled()

    revealCaret.mockClear()
    context.setSelections([{ affinity: 'before', anchor: 0, head: 2 }], 'test.bulkHeadReveal', 2)
    expect(revealCaret).toHaveBeenLastCalledWith(2, 'before', undefined)
    expect(revealOffset).not.toHaveBeenCalled()

    revealCaret.mockClear()
    context.setSelection(0, 0, 'test.revealTarget', {
      reveal: false,
      revealOffset: 2,
    })
    expect(revealCaret).not.toHaveBeenCalled()
    expect(revealOffset).toHaveBeenLastCalledWith(2, undefined)
  })

  it('reveals an explicit post-edit selection through its affinity', () => {
    const capture: EditContributionContextCapture = { context: null }
    editor = new Editor(container, {
      defaultText: 'abc',
      plugins: [captureEditContributionPlugin(capture)],
    })
    const revealCaret = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const revealOffset = vi.spyOn(VirtualizedTextView.prototype, 'revealOffset')
    const context = requireEditContributionContext(capture.context)

    context.applyEdits([{ from: 1, text: 'B', to: 2 }], 'test.edit', {
      affinity: 'before',
      anchor: 2,
      head: 2,
    })

    expect(revealCaret).toHaveBeenLastCalledWith(2, 'before', undefined)
    expect(revealOffset).not.toHaveBeenCalled()
  })

  it('infers selection-head affinity while retaining viewport-end reveal placement', () => {
    const session = createDocumentSession('abc')
    editor = new Editor(container)
    editor.attachSession(session)
    const revealCaret = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const revealOffset = vi.spyOn(VirtualizedTextView.prototype, 'revealOffset')
    const controller = Reflect.get(editor, 'inputSelection') as InputSelectionController
    const applyChange = Reflect.get(controller, 'applyChange') as (
      change: DocumentSessionChange,
      totalName: string,
      totalStart: number,
      options: { readonly revealBlock: 'end'; readonly revealOffset: number },
    ) => void
    const change = session.setSelection(1, 1, { affinity: 'before' })

    applyChange.call(controller, change, 'test.headReveal', 0, {
      revealBlock: 'end',
      revealOffset: 1,
    })

    expect(revealCaret).toHaveBeenLastCalledWith(1, 'before', 'end')
    expect(revealOffset).not.toHaveBeenCalled()
  })

  it('reveals the requested primary selection after normalization reorders the ranges', () => {
    const capture: ViewContributionContextCapture = { context: null }
    editor = new Editor(container, {
      defaultText: 'alpha bravo charlie',
      plugins: [captureViewContributionPlugin(capture)],
    })
    const revealCaret = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const revealOffset = vi.spyOn(VirtualizedTextView.prototype, 'revealOffset')
    const context = requireViewContributionContext(capture.context)

    context.setSelections(
      [
        { affinity: 'before', anchor: 11, head: 6 },
        { affinity: 'after', anchor: 0, head: 5 },
      ],
      'test.reorderedBulkHeadReveal',
      6,
    )

    expect(context.getSnapshot().selections).toMatchObject([
      { anchorOffset: 0, headOffset: 5 },
      { affinity: 'before', anchorOffset: 11, headOffset: 6 },
    ])
    expect(revealCaret).toHaveBeenLastCalledWith(6, 'before', undefined)
    expect(revealOffset).not.toHaveBeenCalled()
  })

  it('reveals the surviving primary side when adjacent ranges share a head', () => {
    const capture: ViewContributionContextCapture = { context: null }
    editor = new Editor(container, {
      defaultText: 'foofoo',
      plugins: [captureViewContributionPlugin(capture)],
    })
    const revealCaret = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const revealOffset = vi.spyOn(VirtualizedTextView.prototype, 'revealOffset')
    const context = requireViewContributionContext(capture.context)

    context.setSelections(
      [
        { affinity: 'before', anchor: 6, head: 3 },
        { affinity: 'after', anchor: 0, head: 3 },
      ],
      'test.adjacentSharedHeadReveal',
      3,
    )

    expect(context.getSnapshot().selections).toMatchObject([
      { affinity: 'after', anchorOffset: 0, headOffset: 3 },
      { affinity: 'before', anchorOffset: 6, headOffset: 3 },
    ])
    expect(revealCaret).toHaveBeenLastCalledWith(3, 'before', undefined)
    expect(revealOffset).not.toHaveBeenCalled()
  })

  it('does not reuse raw-primary affinity after normalization merges its head away', () => {
    const capture: ViewContributionContextCapture = { context: null }
    editor = new Editor(container, {
      defaultText: 'alpha bravo charlie',
      plugins: [captureViewContributionPlugin(capture)],
    })
    const revealCaret = vi.spyOn(VirtualizedTextView.prototype, 'revealCaret')
    const revealOffset = vi.spyOn(VirtualizedTextView.prototype, 'revealOffset')
    const context = requireViewContributionContext(capture.context)

    context.setSelections(
      [
        { affinity: 'before', anchor: 0, head: 6 },
        { affinity: 'after', anchor: 3, head: 8 },
      ],
      'test.mergedBulkReveal',
      6,
    )

    expect(context.getSnapshot().selections).toMatchObject([
      { affinity: 'after', anchorOffset: 0, headOffset: 8 },
    ])
    expect(revealCaret).not.toHaveBeenCalled()
    expect(revealOffset).toHaveBeenLastCalledWith(6, undefined)
  })

  it('runs a nested pass inline rather than opening a second one', () => {
    const changes: unknown[] = []
    editor = new Editor(container, {
      defaultText: 'abc',
      onChange: (_state, change) => {
        if (change) changes.push(change)
      },
    })

    editor.runInOperation(() => {
      editor.runInOperation(() => {
        editor.edit({ from: 0, to: 0, text: 'x' })
      })
      expect(changes).toHaveLength(0)
      editor.edit({ from: 1, to: 1, text: 'y' })
    })

    expect(changes).toHaveLength(1)
    expect(editor.materializeFullText()).toBe('xyabc')
  })

  it('closes a pass that throws part-way, so the next edit still notifies', () => {
    const changes: unknown[] = []
    editor = new Editor(container, {
      defaultText: 'abc',
      onChange: (_state, change) => {
        if (change) changes.push(change)
      },
    })

    expect(() =>
      editor.runInOperation(() => {
        editor.edit({ from: 0, to: 0, text: 'x' })
        throw new Error('pass failed')
      }),
    ).toThrow('pass failed')
    editor.edit({ from: 0, to: 0, text: 'y' })

    expect(changes).toHaveLength(2)
    expect(editor.materializeFullText()).toBe('yxabc')
  })

  it('closes the pass when a listener throws, so the next edit still notifies', () => {
    let failing = true
    const changes: unknown[] = []
    editor = new Editor(container, {
      defaultText: 'abc',
      onChange: (_state, change) => {
        if (!change) return
        if (failing) throw new Error('listener failed')

        changes.push(change)
      },
    })

    expect(() => editor.edit({ from: 0, to: 0, text: 'x' })).toThrow('listener failed')
    failing = false
    editor.edit({ from: 0, to: 0, text: 'y' })

    expect(changes).toHaveLength(1)
    expect(editor.materializeFullText()).toBe('yxabc')
  })

  it('measures a row rect once per pass instead of once per grapheme', () => {
    editor = new Editor(container, { defaultText: 'abc' })
    const readsFor = stubLayout()
    const view = mountMeasuredRowView(container)

    view.textOffsetFromViewportPoint(0, 0)
    const outsideReads = readsFor(mountedRowElement(view))
    const inside = rebuildRowGeometry(view, readsFor)
    editor.runInOperation(() => {
      view.textOffsetFromViewportPoint(0, 0)
    })
    const insideReads = readsFor(inside.element) - inside.reads

    view.dispose()
    expect(outsideReads).toBeGreaterThanOrEqual(MEASURED_ROW_GRAPHEMES)
    expect(insideReads).toBe(1)
  })

  it('forgets measured row rects at the end of the pass', () => {
    editor = new Editor(container, { defaultText: 'abc' })
    const readsFor = stubLayout()
    const view = mountMeasuredRowView(container)

    editor.runInOperation(() => {
      view.textOffsetFromViewportPoint(0, 0)
    })
    const next = rebuildRowGeometry(view, readsFor)
    editor.runInOperation(() => {
      view.textOffsetFromViewportPoint(0, 0)
    })
    const nextReads = readsFor(next.element) - next.reads

    view.dispose()
    // A rect kept past the close would be served into a document that has been
    // re-rendered since it was read.
    expect(nextReads).toBe(1)
  })

  it('re-measures a row rect after a render inside the same pass', () => {
    editor = new Editor(container, { defaultText: 'abc' })
    const readsFor = stubLayout()
    const view = mountMeasuredRowView(container)
    const element = mountedRowElement(view)

    let reads = 0
    let recycled = false
    editor.runInOperation(() => {
      view.textOffsetFromViewportPoint(0, 0)
      editor.edit({ from: 0, to: 0, text: 'z' })
      const rebuilt = rebuildRowGeometry(view, readsFor)
      recycled = rebuilt.element === element
      view.textOffsetFromViewportPoint(0, 0)
      reads = readsFor(rebuilt.element) - rebuilt.reads
    })

    view.dispose()
    // The rect is remembered per row element, so the row has to be the same one
    // for a stale rect to be reachable at all.
    expect(recycled).toBe(true)
    // The render moved the row, and every part of it measured against the rect
    // read beforehand would be offset by however far it travelled.
    expect(reads).toBe(1)
  })

  it('keeps measured row rects when a second editor closes a pass inside this one', () => {
    editor = new Editor(container, { defaultText: 'abc' })
    const secondContainer = document.createElement('div')
    document.body.appendChild(secondContainer)
    const secondEditor = new Editor(secondContainer, { defaultText: 'abc' })
    const readsFor = stubLayout()
    const view = mountMeasuredRowView(container)
    const element = mountedRowElement(view)

    let reads = 0
    let recycled = false
    editor.runInOperation(() => {
      view.textOffsetFromViewportPoint(0, 0)
      secondEditor.runInOperation(() => {})
      const rebuilt = rebuildRowGeometry(view, readsFor)
      recycled = rebuilt.element === element
      view.textOffsetFromViewportPoint(0, 0)
      reads = readsFor(rebuilt.element) - rebuilt.reads
    })

    view.dispose()
    secondEditor.dispose()
    secondContainer.remove()
    expect(recycled).toBe(true)
    // Two editors on one page overlap their passes, and the inner one finishing
    // says nothing about whether the outer one is still measuring.
    expect(reads).toBe(0)
  })
})

describe('pass hand-off', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('hands every change of a pass to the incremental consumers, in order', () => {
    const edits: (readonly {
      readonly from: number
      readonly to: number
      readonly text: string
    }[])[] = []
    editor = new Editor(container, {
      defaultText: 'alpha beta',
      plugins: [createChangeRecordingPlugin(edits)],
    })
    edits.length = 0

    editor.runInOperation(() => {
      editor.edit({ from: 0, to: 5, text: 'ALPHA' })
      editor.edit({ from: 6, to: 10, text: 'BETA' })
    })

    // Syntax is reparsed from one change onto the one before it, so a pass that
    // hands over only its last change leaves the tree derived from a snapshot
    // that never existed.
    expect(edits.map((pass) => pass.map((edit) => edit.text))).toEqual([['ALPHA'], ['BETA']])
  })

  it('lets a listener that edits from inside the flush open a pass of its own', () => {
    const seen: string[] = []
    let injected = false
    editor = new Editor(container, {
      defaultText: 'alpha',
      onChange: () => {
        seen.push(editor.materializeFullText())
        if (injected) return

        injected = true
        editor.edit({ from: 5, to: 5, text: '!' })
      },
    })

    editor.edit({ from: 0, to: 5, text: 'ALPHA' })

    // Two passes, not one: the nested edit cannot append to a pass that has
    // already been drained, or it is applied to the document and reported to
    // nobody.
    expect(seen).toEqual(['ALPHA', 'ALPHA!'])
    expect(editor.materializeFullText()).toBe('ALPHA!')
  })
})
