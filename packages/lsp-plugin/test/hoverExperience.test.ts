import type {
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { LspClient } from '@singapore-editor/lsp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestViewContributionContext } from '@singapore-editor/core/testing'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  DefinitionLinkController,
  type DefinitionLinkControllerOptions,
} from '../src/definitionLinkController'
import { createLanguageServerHoverParticipant } from '../src/hoverParticipant'
import type { ActiveDocument } from '../src/pluginTypes'
import type { LanguageServerHoverUpdate } from '../src/serverSet'
import {
  createHoverController,
  createTooltipController,
  HOVER_ASYNC_DISPATCH_DELAY_MS,
  HOVER_LOADING_DELAY_MS,
  HOVER_REQUEST_DEBOUNCE_MS,
  TOOLTIP_HIDE_DELAY_MS,
} from '@singapore-editor/plugin-ui'
import { connectedEditor, flushPromises, singleLineRange } from './connectedEditor'
import { snapshotDocument } from './snapshotDocument'
import { viewTextFields } from './documentSyncSnapshot'

describe('hover timing and keyboard access', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('passes document identity and version per diagnostic and refuses stale actions', () => {
    let active = activeDocument()
    const diagnostics: lsp.Diagnostic[] = [
      { range: singleLineRange(6, 11), message: 'first warning', severity: 2 },
      { range: singleLineRange(6, 11), message: 'second error', severity: 1 },
    ]
    const run = vi.fn()
    const getDiagnosticActions = vi.fn((context) => [{ label: 'Inspect', run: () => run(context) }])
    const participant = createLanguageServerHoverParticipant({
      router: { hasReady: () => false } as never,
      requestHover: async () => null,
      getActiveDocument: () => active,
      getDiagnostics: () => diagnostics,
      getDiagnosticActions,
      onRequestError: vi.fn(),
    })
    const parts = participant.computeSync!({
      anchor: { offset: 8, range: { start: 6, end: 11 }, source: 'keyboard' },
      snapshot: hoverSnapshot(active, 'const value = 1'),
      signal: new AbortController().signal,
    })
    const action = parts[0]?.notes?.[1]?.actions?.[0]
    expect(action).toBeDefined()
    action!.run()
    expect(run).toHaveBeenCalledExactlyOnceWith({
      documentUri: active.uri,
      textVersion: 1,
      diagnostic: diagnostics[1],
    })
    active = { ...active, textVersion: 2 }
    expect(() => action!.run()).toThrow('The diagnostic changed')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('joins a running action across hovers and reports its failure to the host', async () => {
    const active = activeDocument()
    const diagnostics: lsp.Diagnostic[] = [
      { range: singleLineRange(6, 11), message: 'slow warning', severity: 2 },
    ]
    let fail: (error: Error) => void = () => undefined
    const run = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        }),
    )
    const onRequestError = vi.fn()
    const participant = createLanguageServerHoverParticipant({
      router: { hasReady: () => false } as never,
      requestHover: async () => null,
      getActiveDocument: () => active,
      getDiagnostics: () => diagnostics,
      getDiagnosticActions: () => [{ label: 'Fix', run }],
      onRequestError,
    })
    const actionFromHover = () =>
      participant.computeSync!({
        anchor: { offset: 8, range: { start: 6, end: 11 }, source: 'pointer' },
        snapshot: hoverSnapshot(active, 'const value = 1'),
        signal: new AbortController().signal,
      })[0]?.notes?.[0]?.actions?.[0]

    const first = actionFromHover()!.run()
    const second = actionFromHover()!.run()
    expect(second).toBe(first)
    expect(run).toHaveBeenCalledOnce()

    const failure = new Error('fix failed')
    fail(failure)
    await expect(first).rejects.toBe(failure)
    expect(onRequestError).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it('runs an action after its diagnostic is republished unchanged', () => {
    const active = activeDocument()
    let diagnostics: lsp.Diagnostic[] = [
      { range: singleLineRange(6, 11), message: 'warning', severity: 2 },
    ]
    const run = vi.fn()
    const participant = createLanguageServerHoverParticipant({
      router: { hasReady: () => false } as never,
      requestHover: async () => null,
      getActiveDocument: () => active,
      getDiagnostics: () => diagnostics,
      getDiagnosticActions: () => [{ label: 'Fix', run }],
      onRequestError: vi.fn(),
    })
    const action = participant.computeSync!({
      anchor: { offset: 8, range: { start: 6, end: 11 }, source: 'pointer' },
      snapshot: hoverSnapshot(active, 'const value = 1'),
      signal: new AbortController().signal,
    })[0]?.notes?.[0]?.actions?.[0]

    diagnostics = [{ range: singleLineRange(6, 11), message: 'warning', severity: 2 }]
    action!.run()
    expect(run).toHaveBeenCalledOnce()

    diagnostics = [{ range: singleLineRange(6, 11), message: 'other warning', severity: 2 }]
    expect(() => action!.run()).toThrow('The diagnostic changed')
    expect(run).toHaveBeenCalledOnce()
  })

  it('starts semantic work halfway through the delay and paints only after the full delay', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const value = 1', 6)

    editor.pointerMove(40, 60)
    await vi.advanceTimersByTimeAsync(HOVER_ASYNC_DISPATCH_DELAY_MS - 1)
    expect(editor.hoverRequests()).toHaveLength(0)

    editor.pointerMove(41, 60)
    await vi.advanceTimersByTimeAsync(1)
    expect(editor.hoverRequests()).toHaveLength(1)
    editor.answerHover({ contents: { kind: 'markdown', value: 'the answer' } })
    await flushPromises()

    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS - HOVER_ASYNC_DISPATCH_DELAY_MS - 1)
    expect(tooltip().hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(tooltip().hidden).toBe(false)
    expect(tooltip().textContent).toContain('the answer')
  })

  it('shows a delayed loading row and cancels it when the pointer leaves', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const value = 1', 6)

    editor.pointerMove(40, 60)
    await vi.advanceTimersByTimeAsync(HOVER_LOADING_DELAY_MS - 1)
    expect(tooltip().hidden).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    expect(tooltip().textContent).toContain('Loading…')
    expect(tooltip().getAttribute('aria-busy')).toBe('true')

    tooltip().dispatchEvent(new PointerEvent('pointerleave'))
    await vi.advanceTimersByTimeAsync(TOOLTIP_HIDE_DELAY_MS)
    expect(tooltip().hidden).toBe(true)
  })

  it('inserts progressive server answers in feature-rank order', async () => {
    vi.useFakeTimers()
    const request = deferred<lsp.Hover | null>()
    let publish!: (update: LanguageServerHoverUpdate) => void
    const { controller, element } = hoverController((onUpdate) => {
      publish = onUpdate
      return request.promise
    })

    element.dispatchEvent(new PointerEvent('pointermove', { buttons: 0, clientX: 40, clientY: 60 }))
    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS)

    publish({ hovers: [hover('secondary')], pending: true })
    expect(hoverPartTexts()).toEqual(['secondary'])
    publish({ hovers: [hover('primary'), hover('secondary')], pending: false })
    expect(hoverPartTexts()).toEqual(['primary', 'secondary'])

    request.resolve(hover('primary'))
    await flushPromises()
    controller.dispose()
  })

  it('summons and focuses hover from the caret, then restores editor focus on Escape', async () => {
    const editor = await connectedEditor('const value = 1', 6)

    expect(editor.runCommand('editor.action.showHover')).toBe(true)
    expect(editor.hoverRequests()).toHaveLength(1)
    editor.answerHover({ contents: { kind: 'markdown', value: 'keyboard answer' } })
    await flushPromises()

    const focused = document.activeElement as HTMLElement | null
    expect(focused?.dataset.hoverPartIndex).toBe('0')
    focused?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(tooltip().hidden).toBe(true)
    expect(editor.focusEditor).toHaveBeenCalledTimes(1)
  })
})

describe('hover surface interaction and presentation', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps the hover while the pointer approaches it, but not after it turns away', () => {
    const controller = tooltipController()
    const element = tooltip()
    element.getBoundingClientRect = () => new DOMRect(100, 30, 200, 60)
    controller.show(showOptions(new DOMRect(100, 100, 20, 20)))

    expect(controller.shouldKeepForPointer(110, 110)).toBe(true)
    expect(controller.shouldKeepForPointer(110, 98)).toBe(true)
    expect(controller.shouldKeepForPointer(110, 94)).toBe(true)
    expect(controller.shouldKeepForPointer(400, 400)).toBe(false)

    controller.dispose()
  })

  it('uses editor-sized rows, contextual copy actions, keyboard scrolling, and remembered sashes', () => {
    const controller = tooltipController()
    const element = tooltip()
    element.getBoundingClientRect = () => measuredTooltipRect(element)
    controller.show(showOptions(new DOMRect(100, 400, 20, 20)))

    expect(element.getAttribute('role')).toBe('dialog')
    expect(element.style.minWidth).toBe('150px')
    expect(element.style.maxWidth).toBe('750px')
    expect(element.style.borderRadius).toBe('2px')
    expect(element.style.fontFamily).toContain('--editor-font-family')
    expect(element.style.boxShadow).toContain('28px')

    const part = element.querySelector<HTMLElement>('[data-hover-part-index="0"]')
    const copy = element.querySelector<HTMLButtonElement>('[aria-label="Copy hover text"]')
    if (!part || !copy) throw new Error('missing hover row')
    expect(copy.style.opacity).toBe('0')
    part.dispatchEvent(new MouseEvent('mouseenter'))
    expect(copy.style.opacity).toBe('1')

    const body = element.querySelector<HTMLElement>('.editor-test-hover-body')
    if (!body) throw new Error('missing hover body')
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 800 })
    part.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(body.scrollTop).toBe(800)

    const bottom = element.querySelector<HTMLElement>('.editor-test-hover-resize-bottom')
    const top = element.querySelector<HTMLElement>('.editor-test-hover-resize-top')
    const right = element.querySelector<HTMLElement>('.editor-test-hover-resize-right')
    if (!bottom || !top || !right) throw new Error('missing hover sashes')
    expect(bottom.hidden).toBe(false)
    expect(top.hidden).toBe(true)
    right.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 100 }),
    )
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 280, clientY: 100 }))
    document.dispatchEvent(new PointerEvent('pointerup'))
    expect(element.style.width).toBe('280px')

    controller.hide()
    controller.show(showOptions(new DOMRect(100, 400, 20, 20)))
    expect(element.style.width).toBe('280px')
    controller.dispose()
  })
})

function tooltipController() {
  const editor = document.createElement('div')
  editor.getBoundingClientRect = () => new DOMRect(0, 0, 900, 700)
  document.body.append(editor)
  return createTooltipController({
    document,
    themeSource: editor,
    reentryElement: editor,
    classNamespace: 'test',
  })
}

describe('definition link source spans', () => {
  afterEach(() => document.body.replaceChildren())

  it.each(['.', '/', '-', '@'])(
    'links the whole import string when entered on %s and keeps one link across its segments',
    async (character) => {
      const text = 'import { helper } from "@scope/nested/my-helper.ts"'
      const start = text.indexOf('"')
      const { controller, context, element, request, onDefinitionLinkHover } = hoverController(
        () => Promise.resolve(null),
        text,
      )
      request.mockResolvedValue([
        {
          originSelectionRange: {
            start: { line: 0, character: start },
            end: { line: 0, character: text.length },
          },
          targetUri: 'file:///nested/my-helper.ts',
          targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          targetSelectionRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ])

      vi.mocked(context.textOffsetFromPoint).mockReturnValue(text.indexOf(character, start))
      element.dispatchEvent(
        new PointerEvent('pointermove', { ctrlKey: true, buttons: 0, clientX: 40, clientY: 60 }),
      )
      await flushPromises()
      expect(context.setRangeHighlight).toHaveBeenLastCalledWith(
        expect.any(String),
        [{ start, end: text.length }],
        expect.any(Object),
      )
      expect(element.style.cursor).toBe('pointer')
      expect(onDefinitionLinkHover).toHaveBeenCalledExactlyOnceWith({
        path: 'nested/my-helper.ts',
        uri: 'file:///nested/my-helper.ts',
        range: singleLineRange(0, 1),
      })

      vi.mocked(context.textOffsetFromPoint).mockReturnValue(text.indexOf('-'))
      element.dispatchEvent(
        new PointerEvent('pointermove', { ctrlKey: true, buttons: 0, clientX: 50, clientY: 60 }),
      )
      await flushPromises()
      expect(request).toHaveBeenCalledTimes(1)
      expect(onDefinitionLinkHover).toHaveBeenCalledTimes(1)

      vi.mocked(context.textOffsetFromPoint).mockReturnValue(0)
      request.mockResolvedValue([])
      element.dispatchEvent(
        new PointerEvent('pointermove', { ctrlKey: true, buttons: 0, clientX: 10, clientY: 60 }),
      )
      await flushPromises()
      expect(element.style.cursor).toBe('')
      controller.dispose()
    },
  )
})

describe('definition link hover notification', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('passes the notification through the adapter factory', async () => {
    const onDefinitionLinkHover = vi.fn()
    const editor = await connectedEditor('const value = 1', 6, { onDefinitionLinkHover })

    editor.pointerMove(40, 60, { metaKey: true })
    await flushPromises()
    const target = { uri: 'file:///helper.ts', range: singleLineRange(0, 5) }
    editor.answerDefinition([target])
    await flushPromises()

    await vi.waitFor(() =>
      expect(onDefinitionLinkHover).toHaveBeenCalledExactlyOnceWith({
        ...target,
        path: 'helper.ts',
      }),
    )
    editor.dispose()
  })

  it.each(['metaKey', 'ctrlKey'])(
    'reports the preferred jumpable target after rendering a %s link without navigating',
    async (modifier) => {
      const harness = hoverController(() => Promise.resolve(null))
      const range = singleLineRange(0, 5)
      harness.request.mockResolvedValue([
        { uri: 'file:///repo/node_modules/library/index.ts', range },
        { uri: 'file:///helper.ts', range },
        { uri: 'file:///index.ts', range: singleLineRange(6, 11) },
      ])
      harness.onDefinitionLinkHover.mockImplementation(() => {
        expect(harness.element.style.cursor).toBe('pointer')
        expect(harness.context.setRangeHighlight).toHaveBeenCalled()
      })

      harness.element.dispatchEvent(
        new PointerEvent('pointermove', { [modifier]: true, buttons: 0 }),
      )
      await flushPromises()

      expect(harness.onDefinitionLinkHover).toHaveBeenCalledExactlyOnceWith({
        path: 'helper.ts',
        uri: 'file:///helper.ts',
        range,
      })
      expect(harness.context.setSelection).not.toHaveBeenCalled()
      expect(harness.onOpenDefinition).not.toHaveBeenCalled()
      harness.controller.dispose()
    },
  )

  it('does not notify for ordinary hover', async () => {
    vi.useFakeTimers()
    const harness = hoverController(() => Promise.resolve(hover('value')))

    harness.element.dispatchEvent(new PointerEvent('pointermove', { buttons: 0 }))
    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS)

    expect(tooltip().textContent).toContain('value')
    expect(harness.request).not.toHaveBeenCalled()
    expect(harness.onDefinitionLinkHover).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it.each([
    { targets: [] },
    { targets: [{ uri: 'file:///index.ts', range: singleLineRange(6, 11) }] },
  ])('does not notify when there is no jumpable target: $targets', async ({ targets }) => {
    const harness = hoverController(() => Promise.resolve(null))
    harness.request.mockResolvedValue(targets)

    harness.element.dispatchEvent(new PointerEvent('pointermove', { metaKey: true, buttons: 0 }))
    await flushPromises()

    expect(harness.element.style.cursor).toBe('')
    expect(harness.onDefinitionLinkHover).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it.each(['leave', 'release', 'edit', 'replace', 'dispose'] as const)(
    'ignores a definition answer after %s',
    async (change) => {
      const harness = hoverController(() => Promise.resolve(null))
      const response = deferred<readonly lsp.Location[]>()
      harness.request.mockReturnValue(response.promise)
      harness.element.dispatchEvent(new PointerEvent('pointermove', { metaKey: true, buttons: 0 }))
      expect(harness.request).toHaveBeenCalledTimes(1)

      invalidateDefinitionHover(harness, change)
      response.resolve([{ uri: 'file:///helper.ts', range: singleLineRange(0, 5) }])
      await flushPromises()

      expect(harness.onDefinitionLinkHover).not.toHaveBeenCalled()
      expect(harness.element.style.cursor).toBe('')
      harness.controller.dispose()
    },
  )
})

function invalidateDefinitionHover(
  harness: ReturnType<typeof hoverController>,
  change: 'leave' | 'release' | 'edit' | 'replace' | 'dispose',
) {
  if (change === 'leave') return harness.element.dispatchEvent(new PointerEvent('pointerleave'))
  if (change === 'release') {
    return document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
  }
  if (change === 'edit') return harness.controller.update(harness.context.getSnapshot(), 'content')
  if (change === 'replace') return harness.replaceDocument()
  return harness.controller.dispose()
}

function hoverController(
  requestHover: (
    onUpdate: (update: LanguageServerHoverUpdate) => void,
  ) => Promise<lsp.Hover | null>,
  text = 'const value = 1',
) {
  const element = document.createElement('div')
  document.body.append(element)
  let active = activeDocument(text)
  const snapshot = hoverSnapshot(active, text)
  const request = vi.fn<LspClient['request']>()
  const onDefinitionLinkHover =
    vi.fn<NonNullable<DefinitionLinkControllerOptions['onDefinitionLinkHover']>>()
  const onOpenDefinition = vi.fn()
  const client = {
    initialized: true,
    serverCapabilities: { hoverProvider: true },
    request,
  } as unknown as LspClient
  const router = {
    canResolveCodeActions: () => false,
    hasReady: () => client.initialized,
    request: client.request.bind(client),
  }
  const participant = createLanguageServerHoverParticipant({
    router,
    requestHover: (_params, _options, onUpdate) => requestHover(onUpdate),
    getActiveDocument: () => active,
    getDiagnostics: () => [],
    onRequestError: vi.fn(),
  })
  const context = createTestViewContributionContext({
    container: element,
    scrollElement: element,
    contentElement: element,
    hasDocument: () => true,
    getSnapshot: () => snapshot,
    getProviders: (() => [participant]) as EditorViewContributionContext['getProviders'],
    focusEditor: vi.fn(),
    rowAtPoint: () => null,
    markerAtPoint: () => null,
    textOffsetFromPoint: vi.fn(() => 6),
    getRangeClientRect: vi.fn(() => new DOMRect(10, 20, 40, 18)),
    setSelection: vi.fn(),
    setRangeHighlight: vi.fn(),
    clearRangeHighlight: vi.fn(),
  })
  const hover = createHoverController({ context, classNamespace: 'test' })
  const definitionLink = new DefinitionLinkController({
    context,
    router,
    getActiveDocument: () => active,
    onDefinitionLinkHover,
    onOpenDefinition,
    onRequestError: vi.fn(),
  })
  // One editor view holds both; a test drives them the way the view would.
  const controller = {
    update: (next: EditorViewSnapshot, kind: EditorViewContributionUpdateKind) => {
      hover.update(next, kind)
      definitionLink.update(next, kind)
    },
    dispose: () => {
      definitionLink.dispose()
      hover.dispose()
    },
  }
  return {
    controller,
    context,
    element,
    request,
    onDefinitionLinkHover,
    onOpenDefinition,
    replaceDocument: () => {
      active = activeDocument('const other = 2')
    },
  }
}

function activeDocument(text = 'const value = 1'): ActiveDocument {
  return {
    uri: 'file:///index.ts',
    languageId: 'typescript',
    ...snapshotDocument(text),
    textVersion: 1,
    lspVersion: 1,
  }
}

function hoverSnapshot(active: ActiveDocument, text: string): EditorViewSnapshot {
  return {
    documentId: 'index.ts',
    languageId: active.languageId,
    ...viewTextFields(text),
    textVersion: active.textVersion,
    tokens: [],
    selections: [{ anchorOffset: 6, headOffset: 6, startOffset: 6, endOffset: 6 }],
  } as unknown as EditorViewSnapshot
}

function hover(value: string): lsp.Hover {
  return { contents: { kind: 'markdown', value } }
}

function hoverPartTexts(): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-hover-part-index]'), (part) =>
    part.textContent?.trim(),
  ).filter((text): text is string => Boolean(text))
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function showOptions(anchor: DOMRect) {
  return {
    anchor,
    hoverText: 'hover text',
    theme: null,
    preferredPlacement: 'top' as const,
  }
}

function measuredTooltipRect(element: HTMLElement): DOMRect {
  const styledWidth = Number.parseFloat(element.style.width)
  const styledHeight = Number.parseFloat(element.style.height)
  const width = Number.isFinite(styledWidth) ? styledWidth : 200
  const height = Number.isFinite(styledHeight) ? styledHeight : 100
  return new DOMRect(0, 0, width, height)
}

function tooltip(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.editor-test-hover')
  if (!element) throw new Error('missing tooltip')
  return element
}
