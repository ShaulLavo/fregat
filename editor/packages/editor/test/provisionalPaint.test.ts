import { createEditorHighlighterOperation } from '../src/editor/operationDefinitions'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { VirtualizedTextView } from '../src/virtualization'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/public/document'
import type { EditorInitialPaintEvent, EditorPlugin, EditorViewSnapshot } from '../src/plugins'
import type { EditorHighlightResult } from '../src/syntax/highlighter'
import { setHighlightRegistry } from '../src/public/testing'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import { createError } from '../src/logging/evlog'
import { decodePaintSnapshot } from '../src/editor/paintSnapshot'

const RED_TOKENS = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: 'red' } }])

const editors: Editor[] = []
const hosts: HTMLElement[] = []
const highlights = new Map<string, Highlight>()

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120)
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry({
    set: (name, value) => highlights.set(name, value),
    delete: (name) => highlights.delete(name),
  })
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const host of hosts.splice(0)) host.remove()
  highlights.clear()
  setHighlightRegistry(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('bootstrap emptiness preserves saved rows and an authoritative empty file replaces them', () => {
  const saved = capture('saved paint')
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.host.textContent).toContain('saved paint')
  expect(restored.editor.materializeFullText()).toBe('')
  expect(restored.editor.captureSnapshot()).toBeNull()

  restored.editor.openDocument({ documentId: 'file-a', text: '' })
  expect(restored.editor.getPresentationState()).toBe('live')
  expect(restored.host.textContent).not.toContain('saved paint')
  expect(restored.host.querySelectorAll('.editor-virtualized')).toHaveLength(1)
})

test('content-dependent overlay reservations do not reject bootstrap paint', () => {
  const overlay = (width: number): EditorPlugin => ({
    activate: (context) =>
      context.registerViewContribution({
        createContribution(view) {
          view.reserveOverlayWidth('right', width)
          return { update() {}, dispose() {} }
        },
      }),
  })
  const original = mount({ documentKey: 'file-a', plugins: [overlay(126)] })
  original.editor.openDocument({
    documentId: 'file-a',
    text: 'saved overlay paint',
  })
  const view: unknown = Reflect.get(original.editor, 'view')
  if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 120, 474)
  const saved = original.editor.captureSnapshot()
  expect(saved).not.toBeNull()
  if (!saved) return
  // The fixture sizes this editor through scroll metrics alone, so its outer box is the viewport.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(474)
  const restored = mount(
    { documentKey: 'file-a', snapshot: saved.paint, plugins: [overlay(120)] },
    474,
  )
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.host.textContent).toContain('saved overlay paint')
  expect(restored.editor.materializeFullText()).toBe('')
  restored.editor.openDocument({
    documentId: 'file-a',
    text: 'live overlay paint',
  })
  expect(restored.editor.getPresentationState()).toBe('live')
  expect(restored.host.textContent).toContain('live overlay paint')
})

test('a reservation deferred behind saved paint is announced when the paint commits', () => {
  const heard: number[] = []
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution(view) {
          view.onDidChangeReservedOverlayWidth((side) => {
            heard.push(view.getReservedOverlayWidth(side))
          })
          view.reserveOverlayWidth('right', 120)
          return { update() {}, dispose() {} }
        },
      }),
  }
  const saved = capture('saved paint')
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint, plugins: [plugin] })
  expect(restored.editor.getPresentationState()).toBe('provisional')
  // The saved paint's own width (none) is shown until the document commits.
  expect(heard.at(-1)).toBe(0)
  heard.length = 0

  restored.editor.openDocument({ documentId: 'file-a', text: 'live paint' })

  expect(restored.editor.getPresentationState()).toBe('live')
  expect(heard).toEqual([120])
})

test('real document waits independently for highlights and commits once with no provisional source rows', async () => {
  const saved = capture('saved paint')
  const result = deferredHighlight()
  const events: EditorInitialPaintEvent[] = []
  const states: string[] = []
  const inspection: { read: (() => EditorViewSnapshot) | null } = {
    read: null,
  }
  const inspect: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => {
          inspection.read = () => view.getSnapshot()
          return { update: () => undefined, dispose: () => undefined }
        },
      }),
  }
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    plugins: [delayedHighlighter(result.promise), inspect],
    onInitialPaint: (event) => events.push(event),
    onPresentationChange: (state) => states.push(state),
  })
  const buffer = createEditorTextBuffer('const actual = 1;\nsecond\nthird')
  restored.editor.attachSession(createEditorBufferSession(buffer), {
    documentId: 'file-a',
    languageId: 'typescript',
  })
  await nextTask()

  expect(restored.editor.materializeFullText()).toBe(buffer.materializeFullText())
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.host.textContent).toContain('saved paint')
  expect(restored.host.textContent).not.toContain('const actual')
  expect(events).toEqual([])
  const inspected = inspection.read?.()
  expect(inspected?.geometryCommitted).toBe(false)
  expect(inspected?.visibleRows).toEqual([])
  expect(inspected?.lineCount).toBe(3)
  expect(inspected?.lineStartsView?.length).toBe(3)
  expect(inspected?.textSnapshot).toBe(buffer.getTextSnapshot())
  expect(restored.editor.captureSnapshot()).toBeNull()
  expect(restored.host.querySelectorAll('[data-editor-virtual-row]')).toHaveLength(0)

  result.resolve({ tokens: RED_TOKENS })
  await expect.poll(() => restored.editor.getPresentationState()).toBe('live')
  expect(states).toEqual(['provisional', 'live'])
  expect(events.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
  expect(restored.host.textContent).toContain('const actual')
  expect(restored.host.textContent).not.toContain('saved paint')
  expect(restored.editor.captureSnapshot()).toMatchObject({
    buffer,
    bufferRevision: buffer.getRevision(),
    documentKey: 'file-a',
    documentId: 'file-a',
  })

  restored.editor.setSnapshot(saved.paint, 'file-a')
  restored.editor.setSelection(0)
  restored.editor.edit({ from: 0, to: 0, text: '!' })
  expect(buffer.materializeFullText()).toBe('!const actual = 1;\nsecond\nthird')
  expect(restored.editor.getPresentationState()).toBe('live')
})

test('slow loading and pointer, wheel, focus, input, and programmatic scroll retain saved paint without queuing edits', async () => {
  const saved = capture(Array.from({ length: 80 }, (_, index) => `line ${index}`).join('\n'))
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
  const scroller = restored.host.querySelector<HTMLElement>('.editor-virtualized')!
  const top = scroller.scrollTop
  restored.editor.focus()
  scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 500 }))
  scroller.dispatchEvent(new Event('touchmove', { bubbles: true, cancelable: true }))
  restored.editor.setScrollPosition({ top: 500 })
  restored.editor.edit({ from: 0, to: 0, text: 'queued?' })
  scroller.scrollTop = 900
  scroller.dispatchEvent(new Event('scroll'))
  await new Promise((resolve) => setTimeout(resolve, 1550))
  expect(scroller.scrollTop).toBe(top)
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.editor.materializeFullText()).toBe('')
  restored.editor.openDocument({ documentId: 'file-a', text: 'actual' })
  expect(restored.editor.materializeFullText()).toBe('actual')
})

test('withdrawing eligibility cannot be undone by a stale highlight completion', async () => {
  const saved = capture('saved paint')
  const result = deferredHighlight()
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    plugins: [delayedHighlighter(result.promise)],
  })
  restored.editor.openDocument({
    documentId: 'file-a',
    text: 'const old = 1',
    languageId: 'typescript',
  })
  await nextTask()
  restored.editor.setSnapshot(null, 'file-a')
  restored.editor.clear()
  restored.editor.setSnapshot(null, 'file-b')
  restored.editor.openDocument({ documentId: 'file-b', text: 'current' })
  result.resolve({ tokens: RED_TOKENS })
  await nextTask()
  expect(restored.editor.materializeFullText()).toBe('current')
  expect(restored.host.textContent).not.toContain('saved paint')
  expect(restored.editor.getPresentationState()).toBe('live')
})

test('a contribution that fails after writing is disposed before authoritative paint is published', async () => {
  const saved = capture('saved paint')
  const result = deferredHighlight()
  const paints: EditorInitialPaintEvent[] = []
  let failed = false
  const broken = document.createElement('span')
  broken.textContent = 'partial contribution'
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => ({
          update(snapshot) {
            if (snapshot.documentId !== 'file-a' || snapshot.initialHighlightStatus === 'loading')
              return
            view.container.appendChild(broken)
            failed = true
            throw createError({
              message: 'Injected contribution failure',
              status: 500,
            })
          },
          dispose: () => broken.remove(),
        }),
      }),
  }
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    plugins: [delayedHighlighter(result.promise), plugin],
    onInitialPaint: (event) => paints.push(event),
  })
  restored.editor.openDocument({
    documentId: 'file-a',
    text: 'const actual = 1',
    languageId: 'typescript',
  })
  await nextTask()
  result.resolve({ tokens: EditorTokenStore.empty() })
  await expect.poll(() => restored.editor.getPresentationState()).toBe('live')
  expect(failed).toBe(true)
  expect(broken.isConnected).toBe(false)
  expect(restored.host.textContent).toContain('const actual')
  expect(paints.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
})

test('same-file buffer replacement rejects the previous generation and applies the current scroll once', async () => {
  const text = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')
  const saved = capture(text)
  const result = deferredHighlight()
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    plugins: [delayedHighlighter(result.promise)],
  })
  const first = createEditorTextBuffer(text)
  const replacement = createEditorTextBuffer(`new\n${text}`)
  restored.editor.attachSession(createEditorBufferSession(first), {
    documentId: 'file-a',
    languageId: 'typescript',
    scrollPosition: { top: 40 },
  })
  restored.editor.attachSession(createEditorBufferSession(replacement), {
    documentId: 'file-a',
    languageId: 'typescript',
    scrollPosition: { top: 220 },
  })
  await nextTask()
  result.resolve({ tokens: EditorTokenStore.empty() })
  await expect.poll(() => restored.editor.getPresentationState()).toBe('live')
  expect(restored.editor.getScrollPosition().top).toBe(220)
  expect(restored.editor.captureSnapshot()?.buffer).toBe(replacement)
  restored.editor.setScrollPosition({ top: 320 })
  restored.editor.setSnapshot(saved.paint, 'file-a')
  expect(restored.editor.getScrollPosition().top).toBe(320)
})

test('restore and disposal preserve shared highlight ranges belonging to another editor', async () => {
  const saved = capture('saved paint')
  const other = mount({
    documentKey: 'other',
    plugins: [delayedHighlighter(Promise.resolve({ tokens: RED_TOKENS }))],
  })
  other.editor.openDocument({
    documentId: 'other',
    text: 'const other = 1',
    languageId: 'typescript',
  })
  await nextTask()
  const before = rangesIn(other.host)
  expect(before).toBeGreaterThan(0)
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
  expect(rangesIn(other.host)).toBe(before)
  restored.editor.openDocument({ documentId: 'file-a', text: 'actual' })
  expect(rangesIn(other.host)).toBe(before)
  restored.editor.dispose()
  expect(rangesIn(other.host)).toBe(before)
})

test.each(['{broken', '[]', '{"format":1}', 'x'.repeat(262145)])(
  'invalid saved paint leaves the normal editor usable',
  (snapshot) => {
    const restored = mount({ documentKey: 'file-a', snapshot })
    expect(restored.editor.getPresentationState()).toBe('empty')
    restored.editor.openDocument({ documentId: 'file-a', text: 'actual' })
    expect(restored.editor.getPresentationState()).toBe('live')
    expect(restored.editor.materializeFullText()).toBe('actual')
  },
)

test('saved paint may arrive after the real document while its first highlights are still pending', async () => {
  const saved = capture('saved paint')
  const result = deferredHighlight()
  const restored = mount({
    documentKey: 'file-a',
    plugins: [delayedHighlighter(result.promise)],
  })
  restored.editor.openDocument({
    documentId: 'file-a',
    text: 'const real = 1',
    languageId: 'typescript',
  })
  await nextTask()
  restored.editor.setSnapshot(saved.paint, 'file-a')
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.editor.materializeFullText()).toBe('const real = 1')
  expect(restored.host.textContent).toContain('saved paint')
  result.resolve({ tokens: EditorTokenStore.empty() })
  await nextTask()
  await expect.poll(() => restored.editor.getPresentationState()).toBe('live')
  expect(restored.host.textContent).toContain('const real')
  restored.editor.setSnapshot(null, 'file-a')
  restored.editor.setSnapshot(saved.paint, 'file-a')
  expect(restored.editor.getPresentationState()).toBe('live')
})

test('a declared synchronous paint contributor that remains pending is removed before publication', async () => {
  const result = deferredHighlight()
  let rejectCommit = false
  const partial = document.createElement('span')
  partial.textContent = 'unfinished layer'
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => ({
          snapshotKey: 'required:1',
          captureVisiblePaint: () =>
            rejectCommit
              ? { id: 'required', status: 'pending' }
              : { id: 'required', status: 'ready', rectangles: [] },
          update(snapshot) {
            if (rejectCommit && snapshot.documentId === 'file-a') view.container.append(partial)
          },
          dispose() {
            partial.remove()
          },
        }),
      }),
  }
  const original = mount({ documentKey: 'file-a', plugins: [plugin] })
  original.editor.openDocument({ documentId: 'file-a', text: 'saved paint' })
  const saved = original.editor.captureSnapshot()
  expect(saved).not.toBeNull()
  if (!saved) return
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    plugins: [plugin, delayedHighlighter(result.promise)],
  })
  restored.editor.openDocument({
    documentId: 'file-a',
    text: 'const real = 1',
    languageId: 'typescript',
  })
  await nextTask()
  rejectCommit = true
  result.resolve({ tokens: EditorTokenStore.empty() })
  await expect.poll(() => restored.editor.getPresentationState()).toBe('live')
  expect(partial.isConnected).toBe(false)
  expect(restored.editor.captureSnapshot()).not.toBeNull()
  expect(restored.editor.materializeFullText()).toBe('const real = 1')
})

test('ancestor typography changes withdraw saved geometry without a resize event', async () => {
  const saved = capture('saved paint')
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
  expect(restored.editor.getPresentationState()).toBe('provisional')
  restored.host.style.fontFamily = 'monospace'
  await expect.poll(() => restored.editor.getPresentationState()).toBe('empty')
  expect(restored.host.textContent).not.toContain('saved paint')
})

test('a face still loading at mount does not reject paint saved under the loaded face', () => {
  const saved = capture('saved paint')
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    textMetrics: { rowHeight: 20, characterWidth: 7.8 },
  })
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.host.textContent).toContain('saved paint')
})

test('a scrollbar that arrives with content does not reject the paint saved beside it', () => {
  const saved = capture('saved paint')
  // The empty editor has no scrollbar yet, so its viewport is wider than the saved one.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(606)
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
  expect(restored.editor.getPresentationState()).toBe('provisional')
})

test('a resized editor still rejects paint saved at another size', () => {
  const saved = capture('saved paint')
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
  expect(restored.editor.getPresentationState()).toBe('empty')
})

test('fonts still loading block capture but not the saved paint', () => {
  const saved = capture('saved paint')
  // happy-dom has no FontFaceSet; the editor only reads its status.
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading' } })
  try {
    const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
    expect(restored.editor.getPresentationState()).toBe('provisional')
    const live = mount({ documentKey: 'file-b' })
    live.editor.openDocument({ documentId: 'file-b', text: 'live text' })
    expect(live.editor.captureSnapshot()).toBeNull()
  } finally {
    Reflect.deleteProperty(document, 'fonts')
  }
})

test('explicit navigation requested before the file arrives takes priority over saved scroll', () => {
  const text = Array.from({ length: 80 }, (_, index) => `line ${index}`).join('\n')
  const saved = capture(text)
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint })
  restored.editor.setScrollPosition({ top: 240 })
  restored.editor.openDocument({ documentId: 'file-a', text })
  expect(restored.editor.getScrollPosition().top).toBe(240)
  expect(Reflect.get(restored.editor, 'lastSnapshot')).toBeNull()
  restored.editor.setSnapshot(saved.paint, 'file-a')
  expect(Reflect.get(restored.editor, 'lastSnapshot')).toBeNull()
})

test('delayed files retain nonzero saved scroll and extent without changing the empty model', async () => {
  const text = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')
  const original = mount({ documentKey: 'file-a' })
  original.editor.openDocument({ documentId: 'file-a', text })
  original.editor.setScrollPosition({ top: 600 })
  const capture = original.editor.captureSnapshot()
  expect(capture).not.toBeNull()
  if (!capture) return
  const saved = decodePaintSnapshot(capture.paint)!
  const restored = mount({ documentKey: 'file-a', snapshot: capture.paint })
  const scroller = restored.host.querySelector<HTMLElement>('.editor-virtualized')!
  expect(scroller.scrollTop).toBe(600)
  expect(scroller.scrollHeight).toBe(saved.scrollHeight)
  scroller.scrollTop = 1000
  scroller.dispatchEvent(new Event('scroll'))
  await nextTask()
  expect(scroller.scrollTop).toBe(600)
  expect(scroller.scrollHeight).toBe(saved.scrollHeight)
  expect(restored.editor.materializeFullText()).toBe('')

  restored.editor.openDocument({ documentId: 'file-a', text })
  expect(restored.editor.getPresentationState()).toBe('live')
  expect(restored.editor.getScrollPosition().top).toBe(600)
  restored.editor.setScrollPosition({ top: 800 })
  expect(scroller.scrollTop).toBe(800)
})

test('decoder refuses overlapping rows, inconsistent gutters, and unsupported absolute extents', () => {
  const saved = capture('first\nsecond')
  const paint = decodePaintSnapshot(saved.paint)
  expect(paint).not.toBeNull()
  if (!paint) return
  const row = paint.rows[0]!
  const invalid = [
    { ...paint, rows: [row, row] },
    { ...paint, gutterWidth: paint.gutterWidth + 5 },
    { ...paint, scrollHeight: 16_000_001 },
    { ...paint, scrollWidth: 16_000_001 },
    { ...paint, scrollTop: paint.scrollHeight + 1 },
    { ...paint, rows: [{ ...row, top: paint.scrollHeight + 1 }] },
  ]
  for (const value of invalid) expect(decodePaintSnapshot(JSON.stringify(value))).toBeNull()
})

function rangesIn(host: HTMLElement) {
  let count = 0
  for (const highlight of highlights.values()) {
    for (const range of highlight) {
      if (host.contains(range.startContainer)) count += 1
    }
  }
  return count
}

function mount(options: ConstructorParameters<typeof Editor>[1] = {}, viewportWidth = 600) {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  const editor = new Editor(host, { lineHeight: 20, ...options })
  editors.push(editor)
  const view: unknown = Reflect.get(editor, 'view')
  if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 120, viewportWidth)
  return { editor, host }
}

function capture(text: string) {
  const original = mount({ documentKey: 'file-a' })
  original.editor.openDocument({ documentId: 'file-a', text })
  const snapshot = original.editor.captureSnapshot()
  expect(snapshot).not.toBeNull()
  if (snapshot) return snapshot
  throw createError({
    message: 'Native fixture could not capture paint',
    status: 500,
  })
}

function delayedHighlighter(result: Promise<EditorHighlightResult>): EditorPlugin {
  return {
    activate: (context) =>
      context.registerHighlighter({
        operation: createEditorHighlighterOperation(() => ({
          analyze: () => result,
          dispose: () => undefined,
        })),
      }),
  }
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferredHighlight() {
  let resolve: (value: EditorHighlightResult) => void = () => undefined
  const promise = new Promise<EditorHighlightResult>((complete) => {
    resolve = complete
  })
  return { promise, resolve: (value: EditorHighlightResult) => resolve(value) }
}

test('external projection readiness retains native saved paint until its tokens are installed', () => {
  const saved = capture('saved paint')
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    presentationReady: false,
  })
  restored.editor.setText('live projection', {
    documentMode: 'static',
    languageId: null,
  })
  expect(restored.editor.materializeFullText()).toBe('live projection')
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.host.textContent).toContain('saved paint')
  expect(restored.editor.captureSnapshot()).toBeNull()
  restored.editor.setTokens(RED_TOKENS)
  expect(restored.editor.getPresentationState()).toBe('provisional')
  restored.editor.setPresentationReady(true)
  expect(restored.editor.getPresentationState()).toBe('live')
  expect(restored.host.textContent).toContain('live projection')
  expect(restored.host.textContent).not.toContain('saved paint')
  expect(restored.editor.captureSnapshot()).not.toBeNull()
})

test('synthetic document attachment preserves the provisional visible scroll', () => {
  const text = Array.from({ length: 80 }, (_, index) => `line ${index}`).join('\n')
  const original = mount({ documentKey: 'file-a' })
  original.editor.setText(text, { documentMode: 'static', languageId: null })
  original.editor.setScrollPosition({ top: 240 })
  const saved = original.editor.captureSnapshot()
  expect(saved).not.toBeNull()
  if (!saved) return
  const restored = mount({
    documentKey: 'file-a',
    snapshot: saved.paint,
    presentationReady: false,
  })
  expect(restored.editor.getScrollPosition().top).toBe(240)
  restored.editor.setText(text, { documentMode: 'static', languageId: null })
  restored.editor.setPresentationReady(true)
  expect(restored.editor.getScrollPosition().top).toBe(240)
})

test('selection paint survives provisionally without seeding document selection authority', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('editor-virtualized-selection-range'))
      return new DOMRect(40, 10, 30, 19)
    return new DOMRect(0, 0, 600, 120)
  })
  const original = mount({ documentKey: 'file-a' })
  original.editor.setText('selected text', { documentMode: 'static', languageId: null })
  original.editor.setSelection(0, 8)
  const selection = original.host.querySelector<HTMLElement>('.editor-virtualized-selection-range')
  expect(selection).not.toBeNull()
  if (!selection) return
  selection.style.backgroundColor = 'rgba(56, 189, 248, 0.35)'
  const saved = original.editor.captureSnapshot()
  expect(saved).not.toBeNull()
  if (!saved) return
  const restored = mount({ documentKey: 'file-a', snapshot: saved.paint, presentationReady: false })
  const rectangle = restored.host.querySelector<HTMLElement>(
    '[data-editor-saved-paint-layer="editor.selection"]',
  )
  expect(rectangle?.style.left).toBe('40px')
  expect(rectangle?.style.width).toBe('30px')
  expect(restored.editor.materializeFullText()).toBe('')
  restored.editor.setText('selected text', { documentMode: 'static', languageId: null })
  restored.editor.setPresentationReady(true)
  expect(
    restored.host.querySelector('[data-editor-saved-paint-layer="editor.selection"]'),
  ).toBeNull()
})
