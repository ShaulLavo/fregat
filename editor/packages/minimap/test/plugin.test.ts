import { documentRow } from './visibleRows'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorTextBuffer } from '@singapore-editor/core/document'
import {
  createEditorDocumentAnalysis,
  type EditorDocumentAnalysis,
} from '@singapore-editor/core/editor'
import { installDocumentWorker, type ProjectionWorker } from './documentHarness'
import type {
  EditorCapabilityContributionProvider,
  EditorMinimapDecoration,
  EditorMinimapFeature,
  EditorPluginContext,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { EDITOR_MINIMAP_FEATURE } from '@singapore-editor/core/extensions'
import { MINIMAP_DECORATION_MERGE_LIMIT } from '../src/decorationMerge'
import { createMinimapPlugin } from '../src/plugin'
import { RenderMinimap } from '../src/types'
import { minimapViewportGeometry } from '../src/viewportGeometry'
import type { EditorMinimapOptions, MinimapWorkerRequest } from '../src/types'
import {
  createTestCapabilityContributionContext,
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

// One band past the merge limit, every fifth line: 6000 lines projected onto the
// 600px the editor is tall leave 30 lines inside one band's width, so the run
// paints as a single span while the stragglers 100 lines past it stay themselves.
// Spread over the document's own scroll height instead, a band would cover 2
// lines and none of this would merge.
const DENSE_DOCUMENT_LINES = 6000
const DENSE_DOCUMENT_HEIGHT = 600
const DENSE_RUN_STEP = 5
const DENSE_RUN_END = 1 + MINIMAP_DECORATION_MERGE_LIMIT * DENSE_RUN_STEP
const DENSE_STRAGGLERS = [DENSE_RUN_END + 100, DENSE_RUN_END + 200]
const DENSE_BANDS = rowBands(1, MINIMAP_DECORATION_MERGE_LIMIT + 1, DENSE_RUN_STEP).concat(
  DENSE_STRAGGLERS.map((row) => rowBand(row)),
)
const DENSE_SPANS = [[1, DENSE_RUN_END], ...DENSE_STRAGGLERS.map((row) => [row, row])]

describe('createMinimapPlugin', () => {
  it('registers a view contribution factory', () => {
    const registerViewContribution = vi.fn<EditorPluginContext['registerViewContribution']>(() => ({
      dispose: vi.fn(),
    }))
    const plugin = createMinimapPlugin({ enabled: false })

    const disposable = plugin.activate(
      createTestPluginContext({
        registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
        registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerViewContribution,
        registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
      }),
    )

    expect(plugin.name).toBe('minimap')
    expect(disposable).toBeDefined()
    expect(registerViewContribution).toHaveBeenCalledOnce()
  })

  it('registers decorations through a capability contribution factory', () => {
    let registration: EditorCapabilityContributionProvider | undefined
    const registerCapabilityContribution: EditorPluginContext['registerCapabilityContribution'] = (
      provider,
    ) => {
      registration = provider
      return { dispose: vi.fn() }
    }
    const registerFeature = vi.fn(() => ({ dispose: vi.fn() }))
    const plugin = createMinimapPlugin({ enabled: false })

    plugin.activate(
      createTestPluginContext({
        registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
        registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerViewContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerCapabilityContribution,
        registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
      }),
    )

    const contribution = registration?.createContribution(
      createTestCapabilityContributionContext({ registerFeature }),
    )

    expect(registerFeature).toHaveBeenCalledWith(EDITOR_MINIMAP_FEATURE, expect.any(Object))

    contribution?.dispose()
  })

  it('returns no contribution when disabled', () => {
    let registration: EditorViewContributionProvider | undefined
    const registerViewContribution: EditorPluginContext['registerViewContribution'] = (
      provider,
    ) => {
      registration = provider
      return { dispose: vi.fn() }
    }
    const plugin = createMinimapPlugin({ enabled: false })

    plugin.activate(
      createTestPluginContext({
        registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
        registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerViewContribution,
        registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
        registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
      }),
    )

    expect(registration?.createContribution(context())).toBeNull()
  })

  it.each(['left', 'right'] as const)('reserves only the minimap on the %s edge', (side) => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const providers = activateMinimap({ side })
      const testContext = context(
        snapshot({ clientWidth: 80, clientHeight: 100, scrollWidth: 160, scrollHeight: 200 }),
      )
      testContext.scrollElement.style.scrollbarGutter = 'stable both-edges'
      testContext.scrollElement.style.setProperty('clip-path', 'inset(8px)', 'important')
      defineScrollBox(testContext.scrollElement, {
        offsetWidth: 110,
        offsetHeight: 110,
        clientWidth: 80,
        clientHeight: 100,
      })

      const contribution = providers.view?.createContribution(testContext)
      const host = testContext.container.querySelector<HTMLElement>(`.editor-minimap-${side}`)

      expect(host?.style[side]).toBe(side === 'right' ? '30px' : '0px')
      expect(host?.style.height).toBe('100px')
      expect(testContext.reserveOverlayWidth).toHaveBeenCalledWith(side, 18)
      expect(testContext.scrollElement.style.scrollbarGutter).toBe('stable both-edges')
      expect(testContext.scrollElement.style.clipPath).toBe('inset(8px)')
      expect(testContext.scrollElement.style.getPropertyPriority('clip-path')).toBe('important')

      contribution?.dispose()

      expect(testContext.reserveOverlayWidth).toHaveBeenLastCalledWith(side, 0)
      expect(testContext.scrollElement.style.scrollbarGutter).toBe('stable both-edges')
      expect(testContext.scrollElement.style.clipPath).toBe('inset(8px)')
      expect(testContext.scrollElement.style.getPropertyPriority('clip-path')).toBe('important')
    } finally {
      restoreRuntime.restore()
    }
  })

  it('keeps its reservation fixed while scrolling and padding changes the reported viewport', () => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const providers = activateMinimap()
      const testContext = context(snapshot({ clientWidth: 80, clientHeight: 20 }))
      let reservedLane = 0
      const scrollBox = { offsetWidth: 80, offsetHeight: 20, clientWidth: 80, clientHeight: 20 }
      defineScrollBox(testContext.scrollElement, scrollBox)
      vi.mocked(testContext.reserveOverlayWidth).mockImplementation((_side, width) => {
        reservedLane = width
      })

      const contribution = providers.view?.createContribution(testContext)
      expect(reservedLane).toBe(18)
      vi.mocked(testContext.reserveOverlayWidth).mockClear()

      for (let frame = 0; frame < 6; frame += 1) {
        contribution?.update(
          snapshot({ clientWidth: frame % 2 === 0 ? 80 : 62, scrollLeft: frame * 30 }),
          'viewport',
        )
      }

      expect(testContext.reserveOverlayWidth).not.toHaveBeenCalled()

      scrollBox.offsetWidth = 400
      scrollBox.clientWidth = 400
      scrollBox.offsetHeight = 100
      scrollBox.clientHeight = 100
      contribution?.update(
        snapshot({ clientWidth: 62, clientHeight: 100, borderBoxWidth: 400, borderBoxHeight: 100 }),
        'viewport',
      )
      expect(reservedLane).toBe(54)
      expect(testContext.reserveOverlayWidth).toHaveBeenCalledOnce()

      contribution?.update(
        snapshot({
          clientWidth: 346,
          clientHeight: 100,
          borderBoxWidth: 400,
          borderBoxHeight: 100,
        }),
        'viewport',
      )
      expect(testContext.reserveOverlayWidth).toHaveBeenCalledOnce()
      expect(
        testContext.container.querySelector<HTMLElement>('.editor-minimap')?.style.height,
      ).toBe('100px')

      contribution?.dispose()
    } finally {
      restoreRuntime.restore()
    }
  })

  it.each([0, 0.25])('reuses scroll geometry with a %s px fractional border box', (fraction) => {
    const restoreRuntime = installMinimapRuntime()
    const computedStyle = vi.spyOn(window, 'getComputedStyle')
    try {
      const providers = activateMinimap()
      const dimensions = { borderBoxWidth: 80 + fraction, borderBoxHeight: 20 + fraction }
      const testContext = context(snapshot({ clientWidth: 80, clientHeight: 20, ...dimensions }))
      defineScrollBox(testContext.scrollElement, {
        offsetWidth: 80,
        offsetHeight: 20,
        clientWidth: 80,
        clientHeight: 20,
      })
      const contribution = providers.view?.createContribution(testContext)
      computedStyle.mockClear()

      for (let frame = 0; frame < 6; frame += 1) {
        contribution?.update(snapshot({ scrollTop: frame * 20, ...dimensions }), 'viewport')
      }
      expect(computedStyle).not.toHaveBeenCalled()

      contribution?.update(snapshot(), 'layout')
      expect(computedStyle).toHaveBeenCalled()

      contribution?.dispose()
    } finally {
      computedStyle.mockRestore()
      restoreRuntime.restore()
    }
  })

  it('keeps overlay scrollbar tracks clear without adding their width twice', () => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const providers = activateMinimap()
      const testContext = context(
        snapshot({ clientWidth: 400, clientHeight: 200, scrollWidth: 600, scrollHeight: 800 }),
      )
      testContext.scrollElement.style.setProperty('scrollbar-width', 'thin')
      document.body.appendChild(testContext.container)
      defineScrollBox(testContext.scrollElement, {
        offsetWidth: 400,
        offsetHeight: 200,
        clientWidth: 400,
        clientHeight: 200,
      })

      const contribution = providers.view?.createContribution(testContext)
      const root = testContext.container.querySelector<HTMLElement>('.editor-minimap')

      expect(testContext.reserveOverlayWidth).toHaveBeenCalledWith('right', 61)
      expect(root?.style.right).toBe('7px')
      expect(root?.style.height).toBe('193px')
      expect(testContext.scrollElement.style.clipPath).toBe('')

      vi.mocked(testContext.reserveOverlayWidth).mockClear()
      contribution?.update(
        snapshot({ clientWidth: 339, clientHeight: 200, scrollWidth: 600, scrollHeight: 800 }),
        'viewport',
      )
      expect(testContext.reserveOverlayWidth).not.toHaveBeenCalled()

      testContext.scrollElement.style.setProperty('scrollbar-width', 'none')
      contribution?.update(
        snapshot({ clientWidth: 339, clientHeight: 200, scrollWidth: 600, scrollHeight: 800 }),
        'layout',
      )
      expect(testContext.reserveOverlayWidth).toHaveBeenLastCalledWith('right', 54)
      expect(root?.style.right).toBe('0px')
      expect(root?.style.height).toBe('200px')

      testContext.scrollElement.style.setProperty('scrollbar-width', 'thin')
      contribution?.update(
        snapshot({ clientWidth: 346, clientHeight: 200, scrollWidth: 600, scrollHeight: 800 }),
        'layout',
      )
      expect(testContext.reserveOverlayWidth).toHaveBeenLastCalledWith('right', 61)
      expect(root?.style.right).toBe('7px')
      expect(root?.style.height).toBe('193px')

      contribution?.update(
        snapshot({ clientWidth: 339, clientHeight: 200, scrollWidth: 100, scrollHeight: 100 }),
        'viewport',
      )
      expect(testContext.reserveOverlayWidth).toHaveBeenLastCalledWith('right', 54)
      expect(root?.style.right).toBe('0px')
      expect(root?.style.height).toBe('200px')
      contribution?.dispose()
      expect(testContext.scrollElement.style.clipPath).toBe('')
      testContext.container.remove()
    } finally {
      restoreRuntime.restore()
    }
  })

  it('resizes a hidden minimap when shown without accepting an old worker width', async () => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const providers = activateMinimap()
      const hidden = snapshot({
        clientWidth: 0,
        clientHeight: 0,
        borderBoxWidth: 0,
        borderBoxHeight: 0,
      })
      const testContext = context(hidden)
      let reservedLane = 0
      vi.mocked(testContext.reserveOverlayWidth).mockImplementation((_side, width) => {
        reservedLane = width
      })
      const contribution = providers.view?.createContribution(testContext)
      const root = testContext.container.querySelector<HTMLElement>('.editor-minimap')

      expect(reservedLane).toBe(10)
      expect(root?.style.width).toBe('10px')
      sendLayoutWidth(120)
      expect(reservedLane).toBe(10)
      expect(root?.style.width).toBe('10px')

      defineScrollBox(testContext.scrollElement, {
        offsetWidth: 400,
        offsetHeight: 100,
        clientWidth: 400,
        clientHeight: 100,
      })
      contribution?.update(snapshot({ clientWidth: 390, clientHeight: 100 }), 'viewport')
      expect(reservedLane).toBe(54)
      expect(root?.style.width).toBe('54px')

      vi.mocked(testContext.reserveOverlayWidth).mockClear()
      contribution?.update(snapshot({ clientWidth: 346, clientHeight: 100 }), 'viewport')
      expect(testContext.reserveOverlayWidth).not.toHaveBeenCalled()

      contribution?.dispose()
    } finally {
      restoreRuntime.restore()
    }
  })

  it.each([
    { vertical: 9, horizontal: 6 },
    { vertical: 0, horizontal: 0 },
  ])('honors CSS overlay scrollbar dimensions $vertical × $horizontal', (dimensions) => {
    const restoreRuntime = installMinimapRuntime()
    const testContext = context(
      snapshot({ clientWidth: 80, clientHeight: 20, scrollWidth: 120, scrollHeight: 80 }),
    )
    testContext.scrollElement.style.setProperty('scrollbar-width', 'auto')
    document.body.appendChild(testContext.container)
    defineScrollBox(testContext.scrollElement, {
      offsetWidth: 80,
      offsetHeight: 20,
      clientWidth: 80,
      clientHeight: 20,
    })
    const pseudoStyle = document.createElement('div').style
    pseudoStyle.width = `${dimensions.vertical}px`
    pseudoStyle.height = `${dimensions.horizontal}px`
    const originalComputedStyle = window.getComputedStyle.bind(window)
    const computedStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((element, pseudo) => {
        if (pseudo === '::-webkit-scrollbar') return pseudoStyle
        return originalComputedStyle(element)
      })

    try {
      const contribution = activateMinimap().view?.createContribution(testContext)
      const root = testContext.container.querySelector<HTMLElement>('.editor-minimap')

      expect(testContext.reserveOverlayWidth).toHaveBeenCalledWith(
        'right',
        18 + dimensions.vertical,
      )
      expect(root?.style.right).toBe(`${dimensions.vertical}px`)
      expect(root?.style.height).toBe(`${20 - dimensions.horizontal}px`)

      contribution?.dispose()
    } finally {
      computedStyle.mockRestore()
      testContext.container.remove()
      restoreRuntime.restore()
    }
  })

  it('coalesces slider drag scrolling outside the pointermove handler', () => {
    const restoreRuntime = installMinimapRuntime()
    const animationFrames = installAnimationFrames()
    try {
      let registration: EditorViewContributionProvider | undefined
      const registerViewContribution: EditorPluginContext['registerViewContribution'] = (
        provider,
      ) => {
        registration = provider
        return { dispose: vi.fn() }
      }
      const plugin = createMinimapPlugin({ enabled: true })

      plugin.activate(
        createTestPluginContext({
          registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
          registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
          registerViewContribution,
          registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
          registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
          registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
          registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
          registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
          registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
        }),
      )

      const testContext = context(
        snapshot({
          clientHeight: 100,
          scrollHeight: 500,
        }),
      )
      const current = {
        ...testContext.getSnapshot(),
        lineCount: 100,
        visibleRows: [documentRow(10, 0), documentRow(11, 20)],
      }
      testContext.getSnapshot = () => current
      const contribution = registration?.createContribution(testContext)
      const root = testContext.container.querySelector<HTMLElement>('.editor-minimap')
      const slider = testContext.container.querySelector<HTMLElement>('.editor-minimap-slider')

      expect(contribution).not.toBeNull()
      expect(root).not.toBeNull()
      expect(slider).not.toBeNull()

      defineReadonlyProperty(root!, 'clientHeight', 100)
      defineElementRect(slider!, { height: 20, width: 20 })
      installPointerCapture(slider!)

      dispatchPointer(root!, 'pointerdown', { clientY: 12.204081632653061 })
      expect(testContext.revealLine).not.toHaveBeenCalled()
      dispatchPointer(slider!, 'pointerdown', { clientY: 10 })
      dispatchPointer(slider!.ownerDocument, 'pointermove', { clientY: 50 })

      expect(testContext.setScrollPosition).not.toHaveBeenCalled()
      expect(testContext.scrollElement.scrollTop).toBe(0)

      animationFrames.flush()

      expect(testContext.revealLine).toHaveBeenLastCalledWith(50)
      expect(testContext.setScrollPosition).not.toHaveBeenCalled()

      dispatchPointer(slider!.ownerDocument, 'pointermove', { clientY: 60 })
      dispatchPointer(slider!.ownerDocument, 'pointerup', { clientY: 60 })

      expect(testContext.revealLine).toHaveBeenLastCalledWith(61)
      expect(animationFrames.pendingCount()).toBe(0)

      contribution?.dispose()
    } finally {
      animationFrames.restore()
      restoreRuntime.restore()
    }
  })

  it('sends a dense source to the worker as row bands', async () => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const providers = activateMinimap()
      const registry = registeredMinimapFeature(providers.capability)

      registry.setDecorations('find', DENSE_BANDS)
      const contribution = providers.view?.createContribution(
        context(documentSnapshot(DENSE_DOCUMENT_LINES, DENSE_DOCUMENT_HEIGHT)),
      )

      await restoreRuntime.settle()
      await restoreRuntime.settle()
      expect(externalDecorations()?.map(span)).toEqual(DENSE_SPANS)

      contribution?.dispose()
    } finally {
      restoreRuntime.restore()
    }
  })

  it('rejects minimap navigation against provisional geometry and accepts the first live click', () => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const providers = activateMinimap()
      let current = { ...documentSnapshot(40, 100), geometryCommitted: false }
      const testContext = context(current)
      testContext.getSnapshot = () => current
      const contribution = providers.view?.createContribution(testContext)
      const root = testContext.container.querySelector<HTMLElement>('.editor-minimap')
      const slider = testContext.container.querySelector<HTMLElement>('.editor-minimap-slider')
      expect(root).not.toBeNull()
      expect(slider).not.toBeNull()
      defineElementRect(root!, { height: 100, width: 20 })
      dispatchPointer(root!, 'pointerdown', { clientY: 50 })
      dispatchPointer(slider!, 'pointerdown', { clientY: 20 })
      dispatchPointer(slider!.ownerDocument, 'pointermove', { clientY: 60 })
      expect(testContext.revealLine).not.toHaveBeenCalled()
      expect(testContext.scrollElement.scrollTop).toBe(0)
      expect(testContext.reserveOverlayWidth).not.toHaveBeenCalled()

      current = { ...current, geometryCommitted: true }
      contribution?.update(current, 'document')
      dispatchPointer(root!, 'pointerdown', { clientY: 50 })

      expect(testContext.revealLine).toHaveBeenCalledWith(25)
      expect(testContext.reserveOverlayWidth).toHaveBeenCalled()
      contribution?.dispose()
    } finally {
      restoreRuntime.restore()
    }
  })

  it('forwards continuous viewport updates without reading layout or document snapshots', async () => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const initial = documentSnapshot(200, 100)
      const testContext = context(initial)
      const contribution = activateMinimap().view?.createContribution(testContext)
      await restoreRuntime.settle()
      const snapshots = vi.spyOn(testContext, 'getSnapshot')
      const measurements = vi.spyOn(window, 'getComputedStyle')
      const viewport = { ...initial.viewport, scrollTop: 15, visibleRange: { start: 0, end: 6 } }

      contribution?.updateViewport?.(viewport)

      expect(
        postedRequests().findLast((request) => request.type === 'updateViewport'),
      ).toMatchObject({
        type: 'updateViewport',
        viewport: { scrollTop: 15, visibleStart: 0, visibleEnd: 0 },
      })
      expect(snapshots).not.toHaveBeenCalled()
      expect(measurements).not.toHaveBeenCalled()
      measurements.mockRestore()
      snapshots.mockRestore()
      contribution?.dispose()
    } finally {
      restoreRuntime.restore()
    }
  })

  it('merges the bands a source registers while the minimap is already open', async () => {
    const restoreRuntime = installMinimapRuntime()
    try {
      const providers = activateMinimap()
      const registry = registeredMinimapFeature(providers.capability)
      // A minimap is there from the moment the editor opens and a search runs
      // later, so what the constructor assembled says nothing about the payload a
      // source's own change sends.
      const contribution = providers.view?.createContribution(
        context(documentSnapshot(DENSE_DOCUMENT_LINES, DENSE_DOCUMENT_HEIGHT)),
      )
      await restoreRuntime.settle()

      registry.setDecorations('find', DENSE_BANDS)

      await restoreRuntime.settle()
      expect(externalDecorations()?.map(span)).toEqual(DENSE_SPANS)

      contribution?.dispose()
    } finally {
      restoreRuntime.restore()
    }
  })
})

describe('minimap rail layout', () => {
  it('preserves allocated scrollbars and borders without counting them as minimap padding', () => {
    const geometry = minimapViewportGeometry('right', 54, {
      width: 414,
      height: 222,
      clientWidth: 400,
      clientHeight: 200,
      borders: { left: 2, right: 2, top: 3, bottom: 3 },
      overlayScrollbars: { vertical: 15, horizontal: 15 },
      overflowsX: true,
      overflowsY: true,
    })

    expect(geometry).toEqual({
      reservedWidth: 54,
      top: 3,
      left: 2,
      right: 12,
      height: 200,
      verticalScrollbar: 10,
      horizontalScrollbar: 16,
    })
  })

  it('keeps a left minimap above the horizontal track without reserving the right track', () => {
    const geometry = minimapViewportGeometry('left', 54, {
      width: 400,
      height: 200,
      clientWidth: 400,
      clientHeight: 200,
      borders: { left: 0, right: 0, top: 0, bottom: 0 },
      overlayScrollbars: { vertical: 7, horizontal: 7 },
      overflowsX: true,
      overflowsY: true,
    })

    expect(geometry.reservedWidth).toBe(54)
    expect(geometry.height).toBe(193)
  })
})

function activateMinimap(options: EditorMinimapOptions = {}): {
  readonly capability: EditorCapabilityContributionProvider | undefined
  readonly view: EditorViewContributionProvider | undefined
} {
  let capability: EditorCapabilityContributionProvider | undefined
  let view: EditorViewContributionProvider | undefined

  createMinimapPlugin({ enabled: true, ...options }).activate(
    createTestPluginContext({
      registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
      registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerViewContribution: (provider) => {
        view = provider
        return { dispose: vi.fn() }
      },
      registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
      registerCapabilityContribution: (provider) => {
        capability = provider
        return { dispose: vi.fn() }
      },
      registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
      registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
      registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
      registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
    }),
  )

  return { capability, view }
}

function registeredMinimapFeature(
  provider: EditorCapabilityContributionProvider | undefined,
): EditorMinimapFeature {
  const registered: EditorMinimapFeature[] = []
  provider?.createContribution(
    createTestCapabilityContributionContext({
      registerFeature: (_token, feature) => {
        registered.push(feature as EditorMinimapFeature)
        return { dispose: vi.fn() }
      },
    }),
  )

  const feature = registered[0]
  if (!feature) throw new Error('missing minimap decoration registry')
  return feature
}

function rowBands(
  firstRow: number,
  count: number,
  step: number,
): readonly EditorMinimapDecoration[] {
  return Array.from({ length: count }, (_unused, index) => rowBand(firstRow + index * step))
}

function rowBand(row: number): EditorMinimapDecoration {
  return {
    startLineNumber: row,
    startColumn: 1,
    endLineNumber: row,
    endColumn: 1,
    color: 'rgba(234, 179, 8, 0.34)',
    position: 'inline',
  }
}

function span(decoration: EditorMinimapDecoration): readonly number[] {
  return [decoration.startLineNumber, decoration.endLineNumber]
}

function documentSnapshot(lineCount: number, clientHeight: number): EditorViewSnapshot {
  const lines = Array.from({ length: lineCount }, (_unused, index) => `line ${index + 1}`)
  const lineStarts = [0]
  for (const line of lines.slice(0, -1)) lineStarts.push(lineStarts.at(-1)! + line.length + 1)

  return {
    ...snapshot({ clientHeight, scrollHeight: lineCount * 20 }),
    ...createTestViewSnapshotSource(lines.join('\n')),
    lineStarts,
    lineCount,
    totalHeight: lineCount * 20,
  }
}

function context(viewSnapshot = snapshot()): EditorViewContributionContext {
  const read = viewSnapshot.textSnapshot
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer(read.readRange(0, read.length)),
    documentId: 'plugin-minimap',
  })
  analyses.push(analysis)
  const canonical = {
    ...viewSnapshot,
    documentSyncPoint: analysis.buffer.getDocumentSyncPoint(),
    textVersion: analysis.buffer.getDocumentSyncPoint().textVersion,
  }
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  scrollElement.style.setProperty('scrollbar-width', 'none')
  container.appendChild(scrollElement)
  return createTestViewContributionContext({
    container,
    scrollElement,
    contentElement: scrollElement,
    getSnapshot: () => canonical,
    getDocumentContributions: () => analysis.contributions,
    reserveOverlayWidth: vi.fn(),
    revealLine: vi.fn(),
    setScrollPosition: vi.fn(),
  })
}

function snapshot(viewport: Partial<EditorViewSnapshot['viewport']> = {}): EditorViewSnapshot {
  return {
    documentId: 'minimap-test',
    languageId: 'typescript',
    ...createTestViewSnapshotSource(''),
    textVersion: 1,
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    documentSyncPoint: {
      revision: 1,
      segment: Object.freeze({}) as EditorViewSnapshot['documentSyncPoint']['segment'],
      textVersion: 1,
    },
    changesSinceDocumentSyncPoint: () => null,
    lineStarts: [0],
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 1,
    contentWidth: 0,
    totalHeight: 20,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollTop: 0,
      scrollRow: (viewport.scrollTop ?? 0) / 20,
      scrollLeft: 0,
      scrollHeight: 20,
      scrollWidth: 0,
      clientHeight: 20,
      clientWidth: 80,
      borderBoxHeight: 20,
      borderBoxWidth: 80,
      visibleRange: { start: 0, end: 1 },
      ...viewport,
    },
    toVisibleSnapshot() {
      return null
    },
  }
}

let mockWorkers: ProjectionWorker[] = []
const analyses: EditorDocumentAnalysis[] = []
afterEach(() => {
  for (const analysis of analyses.splice(0)) analysis.dispose()
})

function installMinimapRuntime() {
  const runtime = installDocumentWorker()
  mockWorkers = runtime.workers
  return runtime
}

function externalDecorations(): readonly EditorMinimapDecoration[] | null {
  const posted = postedRequests().findLast(
    (request): request is Extract<MinimapWorkerRequest, { type: 'updateExternalDecorations' }> =>
      request.type === 'updateExternalDecorations',
  )
  return posted?.decorations ?? null
}

// Nothing else reaches the worker until the render it is already waiting on comes
// back, so a case that wants to see a later message has to answer this one.
function sendLayoutWidth(width: number): void {
  const worker = mockWorkers.at(-1)
  if (!worker) throw new Error('missing minimap worker')

  worker.send({
    type: 'layout',
    sequence: 1,
    layout: {
      width,
      height: 100,
      canvasInnerWidth: width,
      canvasInnerHeight: 100,
      canvasOuterWidth: width,
      canvasOuterHeight: 100,
      lineHeight: 2,
      charWidth: 1,
      scale: 1,
      isSampling: false,
      heightIsEditorHeight: false,
      renderMinimap: RenderMinimap.Text,
    },
  })
}

function postedRequests(): readonly MinimapWorkerRequest[] {
  const worker = mockWorkers.at(-1)
  if (!worker) return []

  return worker.requests
}

function defineScrollBox(
  element: HTMLElement,
  dimensions: Pick<HTMLElement, 'offsetWidth' | 'offsetHeight' | 'clientWidth' | 'clientHeight'>,
): void {
  for (const property of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight'] as const) {
    Object.defineProperty(element, property, {
      configurable: true,
      get: () => dimensions[property],
    })
  }
}

function defineReadonlyProperty(
  element: HTMLElement,
  property: 'clientHeight',
  value: number,
): void {
  Object.defineProperty(element, property, {
    configurable: true,
    value,
  })
}

function defineElementRect(
  element: HTMLElement,
  rect: { readonly height: number; readonly width: number },
): void {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.height,
      height: rect.height,
      left: 0,
      right: rect.width,
      top: 0,
      width: rect.width,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect
}

function installPointerCapture(element: HTMLElement): void {
  Object.defineProperty(element, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(element, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(() => true),
  })
  Object.defineProperty(element, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: { readonly clientY: number; readonly pointerId?: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientY: init.clientY,
  })
  Object.defineProperty(event, 'pointerId', {
    configurable: true,
    value: init.pointerId ?? 1,
  })
  target.dispatchEvent(event)
}

function installAnimationFrames(): {
  readonly flush: () => void
  readonly pendingCount: () => number
  readonly restore: () => void
} {
  const requestAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const cancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  const frames = new Map<number, () => void>()
  let nextFrame = 1

  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: () => void) => {
      const frame = nextFrame
      nextFrame += 1
      frames.set(frame, callback)
      return frame
    },
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (frame: number) => frames.delete(frame),
  })

  return {
    flush: () => {
      const pending = new Map(frames)
      frames.clear()
      for (const callback of pending.values()) callback()
    },
    pendingCount: () => frames.size,
    restore: () => {
      restoreDescriptor(globalThis, 'requestAnimationFrame', requestAnimationFrame)
      restoreDescriptor(globalThis, 'cancelAnimationFrame', cancelAnimationFrame)
    },
  }
}

function restoreDescriptor(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
    return
  }

  Reflect.deleteProperty(target, property)
}
