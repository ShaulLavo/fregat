import { documentRow } from './visibleRows'
import { documentLineAtY, documentLineForSliderY, visibleDocumentLineRange } from '../src/layout'
import { describe, expect, it } from 'vitest'
import {
  computeFrameLayout,
  computeRenderLayout,
  MINIMAP_GUTTER_WIDTH,
  MINIMAP_RIGHT_GUTTER_WIDTH,
  type MinimapFrameLayout,
  yForLineNumber,
} from '../src/layout'
import { resolveMinimapOptions } from '../src/options'
import { RenderMinimap, type MinimapRenderLayout, type MinimapViewport } from '../src/types'

describe('minimap layout', () => {
  it.each(['proportional', 'fill', 'fit'] as const)(
    'maps wrapped and folded bounds in %s mode',
    (size) => {
      const editorViewport = {
        ...viewport({ scrollTop: 100, clientHeight: 100 }),
        borderBoxHeight: 100,
        borderBoxWidth: 800,
        visibleRange: { start: 5, end: 10 },
      }
      const rows = [
        documentRow(8, 80),
        documentRow(10, 100, { firstWrapSegment: false }),
        documentRow(10, 120, { firstWrapSegment: false }),
        documentRow(11, 140, { source: 'injected' }),
        documentRow(50, 160),
        documentRow(51, 180),
        documentRow(52, 200),
      ]
      const range = visibleDocumentLineRange({ visibleRows: rows, lineCount: 100 }, editorViewport)
      expect(range).toEqual({ start: 10, end: 52 })
      const current = viewport({
        clientHeight: 200,
        visibleStart: range.start,
        visibleEnd: range.end,
      })
      const metrics = { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 }
      const renderLayout = computeRenderLayout({
        minimap: resolveMinimapOptions({ size }),
        metrics,
        viewport: current,
        lineCount: 100,
      })
      const frame = computeFrameLayout({
        renderLayout,
        metrics,
        viewport: current,
        lineCount: 100,
        realLineCount: 100,
        previous: null,
      })
      expect(documentLineForSliderY(frame, frame.sliderTop)).toBeCloseTo(10)
      expect(documentLineAtY(frame, frame.sliderTop)).toBeCloseTo(10)
      expect(documentLineAtY(frame, frame.sliderTop + frame.sliderHeight)).toBeCloseTo(52)
      expect(documentLineAtY(frame, frame.sliderTop + frame.sliderHeight / 2)).toBeCloseTo(31)
    },
  )

  it('fits a collapsed document span larger than the proportional raster', () => {
    const current = viewport({ clientHeight: 100, visibleStart: 10, visibleEnd: 990 })
    const metrics = { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 }
    const renderLayout = computeRenderLayout({
      minimap: resolveMinimapOptions(),
      metrics,
      viewport: current,
      lineCount: 1000,
    })
    const frame = computeFrameLayout({
      renderLayout,
      metrics,
      viewport: current,
      lineCount: 100,
      realLineCount: 1000,
      previous: null,
    })
    expect(renderLayout.isSampling).toBe(true)
    expect(documentLineForSliderY(frame, frame.sliderTop)).toBeCloseTo(10)
    expect(documentLineAtY(frame, frame.sliderTop)).toBeCloseTo(10)
    expect(documentLineAtY(frame, frame.sliderTop + frame.sliderHeight)).toBeCloseTo(990)
  })

  it('retains a document line when only wrap continuations are on screen', () => {
    const current = {
      ...viewport({ clientHeight: 40 }),
      borderBoxWidth: 800,
      borderBoxHeight: 40,
      visibleRange: { start: 20, end: 22 },
    }
    expect(
      visibleDocumentLineRange(
        {
          lineCount: 100,
          visibleRows: [
            documentRow(7, 0, { firstWrapSegment: false }),
            documentRow(7, 20, { firstWrapSegment: false }),
          ],
        },
        current,
      ),
    ).toEqual({ start: 7, end: 8 })
  })

  it('computes proportional render dimensions from editor metrics', () => {
    const layout = computeRenderLayout({
      minimap: resolveMinimapOptions({ maxColumn: 80, scale: 2 }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 },
      viewport: viewport({ clientHeight: 400, clientWidth: 800, scrollWidth: 1200 }),
      lineCount: 100,
    })

    expect(layout.renderMinimap).toBe(RenderMinimap.Text)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.canvasInnerWidth).toBeGreaterThan(layout.width)
    expect(layout.canvasInnerHeight).toBe(800)
    expect(layout.charWidth).toBe(4)
    expect(layout.lineHeight).toBe(8)
  })

  it('fits the slider above the horizontal scrollbar without changing the editor scroll range', () => {
    const metrics = { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 }
    const editorViewport = viewport({
      clientHeight: 600,
      minimapHeight: 580,
      scrollHeight: 6000,
      scrollTop: 5400,
      visibleStart: 270,
      visibleEnd: 300,
    })
    const renderLayout = computeRenderLayout({
      minimap: resolveMinimapOptions({ size: 'fill' }),
      metrics,
      viewport: editorViewport,
      lineCount: 300,
    })
    const frame = computeFrameLayout({
      renderLayout,
      metrics,
      viewport: editorViewport,
      lineCount: 300,
      realLineCount: 300,
      previous: null,
    })

    expect(renderLayout.height).toBe(580)
    expect(frame.sliderHeight).toBe(30)
    expect(frame.sliderTop + frame.sliderHeight).toBeCloseTo(300)
  })

  // The lane the minimap reserves is padding, and padding leaves the content box, so
  // sizing from `clientWidth` alone makes the minimap an input to its own width. The
  // gain is under 1, so it converges in the reals — but `floor`/`ceil` park it in a
  // one-pixel two-frame cycle that never settles.
  it('sizes against the editor width the lane was taken from', () => {
    const layoutFor = (clientWidth: number, reservedWidth: number) =>
      computeRenderLayout({
        minimap: resolveMinimapOptions({ maxColumn: 80, scale: 2 }),
        metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 },
        viewport: viewport({ clientHeight: 400, clientWidth, reservedWidth, scrollWidth: 1200 }),
        lineCount: 100,
      })

    const editorWidth = 800
    const unreserved = layoutFor(editorWidth, 0)

    // Feed the lane back the way the browser does, then keep feeding: every later frame
    // must land on the same width, or the minimap is still chasing itself.
    let lane = Math.ceil(unreserved.width)
    for (let frame = 0; frame < 6; frame += 1) {
      const next = layoutFor(editorWidth - lane, lane)
      expect(next.width).toBe(unreserved.width)
      lane = Math.ceil(next.width)
    }
  })

  it('falls back to block rendering when character rendering is disabled', () => {
    const layout = computeRenderLayout({
      minimap: resolveMinimapOptions({ enabled: true, renderCharacters: false }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 },
      viewport: viewport({ clientHeight: 240, clientWidth: 600 }),
      lineCount: 20,
    })

    expect(layout.renderMinimap).toBe(RenderMinimap.Blocks)
  })

  it('keeps the original text inset while reserving a right gutter', () => {
    const layout = computeRenderLayout({
      minimap: resolveMinimapOptions({ maxColumn: 10_000, scale: 1 }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 },
      viewport: viewport({ clientHeight: 400, clientWidth: 800, scrollWidth: 800 }),
      lineCount: 100,
    })

    expect(MINIMAP_GUTTER_WIDTH).toBe(2)
    expect(MINIMAP_RIGHT_GUTTER_WIDTH).toBe(8)
    expect(layout.charWidth).toBe(2)
    expect(layout.width).toBe(98)
  })

  it('keeps the CSS canvas width stable when fill mode widens the backing store', () => {
    const layout = computeRenderLayout({
      minimap: resolveMinimapOptions({ maxColumn: 10_000, size: 'fill', scale: 1 }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 },
      viewport: viewport({ clientHeight: 600, clientWidth: 800, scrollWidth: 800 }),
      lineCount: 10,
    })

    expect(layout.heightIsEditorHeight).toBe(true)
    expect(layout.lineHeight).toBe(40)
    expect(layout.scale).toBe(3)
    expect(layout.canvasOuterWidth).toBe(layout.width)
    expect(layout.canvasInnerWidth).toBeGreaterThan(layout.canvasOuterWidth * 2)
    expect(layout.canvasOuterHeight).toBe(600)
    expect(layout.canvasInnerHeight).toBe(1200)
  })

  it('compares fit-mode document height in device pixels', () => {
    const layout = computeRenderLayout({
      minimap: resolveMinimapOptions({ size: 'fit', scale: 1 }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 },
      viewport: viewport({ clientHeight: 400, clientWidth: 800, scrollWidth: 800 }),
      lineCount: 150,
    })

    expect(layout.heightIsEditorHeight).toBe(false)
    expect(layout.lineHeight).toBe(4)
    expect(layout.canvasInnerHeight).toBe(800)
    expect(layout.canvasOuterHeight).toBe(400)
  })

  it('returns no render mode when minimap is disabled', () => {
    const layout = computeRenderLayout({
      minimap: resolveMinimapOptions({ enabled: false }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 },
      viewport: viewport(),
      lineCount: 20,
    })

    expect(layout.renderMinimap).toBe(RenderMinimap.None)
  })

  it('keeps minimap width stable when only scrollable content width changes', () => {
    const narrowContent = computeRenderLayout({
      minimap: resolveMinimapOptions({ maxColumn: 10_000, scale: 1 }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 },
      viewport: viewport({ clientHeight: 400, clientWidth: 800, scrollWidth: 800 }),
      lineCount: 100,
    })
    const wideContent = computeRenderLayout({
      minimap: resolveMinimapOptions({ maxColumn: 10_000, scale: 1 }),
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 2 },
      viewport: viewport({ clientHeight: 400, clientWidth: 800, scrollWidth: 2400 }),
      lineCount: 100,
    })

    expect(wideContent.width).toBe(narrowContent.width)
  })

  it('uses contained layout for fit mode and clamps the visible range', () => {
    const renderLayout: MinimapRenderLayout = {
      width: 80,
      height: 100,
      canvasInnerWidth: 80,
      canvasInnerHeight: 100,
      canvasOuterWidth: 80,
      canvasOuterHeight: 100,
      lineHeight: 2,
      charWidth: 1,
      scale: 1,
      isSampling: false,
      heightIsEditorHeight: true,
      renderMinimap: RenderMinimap.Text,
    }

    const frame = computeFrameLayout({
      renderLayout,
      metrics: { rowHeight: 10, characterWidth: 8, devicePixelRatio: 1 },
      viewport: viewport({
        clientHeight: 100,
        scrollHeight: 500,
        scrollTop: 200,
        visibleStart: 20,
        visibleEnd: 30,
      }),
      lineCount: 50,
      realLineCount: 50,
      previous: null,
    })

    expect(frame.sliderNeeded).toBe(true)
    expect(frame.sliderTop).toBe(40)
    expect(frame.sliderHeight).toBe(20)
    expect(frame.startLineNumber).toBe(1)
    expect(frame.endLineNumber).toBe(50)
    expect(yForLineNumber(frame, 3, renderLayout.lineHeight)).toBe(4)
  })

  // The slider stands for the viewport inside the minimap. Sizing it from the minimap's
  // own line height instead of the editor's row height cancels both terms and leaves
  // `clientHeight / devicePixelRatio` — a slider the size of the whole minimap.
  it('sizes the slider from the rows the viewport shows, not the device pixel ratio', () => {
    const rowHeight = 20
    const lineCount = 2000
    const clientHeight = 800
    const sliderFractionAt = (devicePixelRatio: number) => {
      const editorViewport = viewport({
        clientHeight,
        clientWidth: 900,
        scrollHeight: lineCount * rowHeight,
      })
      const metrics = { rowHeight, characterWidth: 8, devicePixelRatio }
      const renderLayout = computeRenderLayout({
        minimap: resolveMinimapOptions(),
        metrics,
        viewport: editorViewport,
        lineCount,
      })
      const frame = computeFrameLayout({
        renderLayout,
        metrics,
        viewport: editorViewport,
        lineCount,
        realLineCount: lineCount,
        previous: null,
      })
      return frame.sliderHeight / renderLayout.height
    }

    // 40 of 2000 lines are on screen, so the slider is a thin band whichever display
    // the editor is on — never the whole rail.
    for (const devicePixelRatio of [1, 1.25, 2]) {
      expect(sliderFractionAt(devicePixelRatio)).toBeLessThan(0.2)
      expect(sliderFractionAt(devicePixelRatio)).toBeGreaterThan(0)
    }
  })

  it('keeps proportional frame movement monotonic while scrolling', () => {
    const renderLayout: MinimapRenderLayout = {
      width: 80,
      height: 100,
      canvasInnerWidth: 80,
      canvasInnerHeight: 100,
      canvasOuterWidth: 80,
      canvasOuterHeight: 100,
      lineHeight: 5,
      charWidth: 1,
      scale: 1,
      isSampling: false,
      heightIsEditorHeight: false,
      renderMinimap: RenderMinimap.Text,
    }
    const first = computeFrameLayout({
      renderLayout,
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 },
      viewport: viewport({
        visibleStart: 25,
        scrollRow: 25,
        scrollTop: 500,
        scrollHeight: 4000,
        clientHeight: 100,
      }),
      lineCount: 200,
      realLineCount: 200,
      previous: null,
    })
    const second = computeFrameLayout({
      renderLayout,
      metrics: { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 },
      viewport: viewport({
        visibleStart: 40,
        scrollRow: 40,
        scrollTop: 800,
        scrollHeight: 4000,
        clientHeight: 100,
      }),
      lineCount: 200,
      realLineCount: 200,
      previous: first,
    })

    expect(second.startLineNumber).toBeGreaterThanOrEqual(first.startLineNumber)
    expect(second.endLineNumber).toBeLessThanOrEqual(200)
  })

  it('moves between raster rows while keeping the viewport aligned with the slider', () => {
    const metrics = { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1.25 }
    const base = viewport({ clientHeight: 85, scrollHeight: 40_000 })
    const renderLayout = computeRenderLayout({
      minimap: resolveMinimapOptions(),
      metrics,
      viewport: base,
      lineCount: 2000,
    })
    let previous: MinimapFrameLayout | null = null
    let previousOrigin = 0
    for (let scrollTop = 1000; scrollTop <= 1020; scrollTop += 1) {
      const current = {
        ...base,
        scrollTop,
        scrollRow: scrollTop / 20,
        visibleStart: scrollTop / 20,
        visibleEnd: (scrollTop + 85) / 20,
      }
      const next = computeFrameLayout({
        renderLayout,
        metrics,
        viewport: current,
        lineCount: 2000,
        realLineCount: 2000,
        previous,
      })
      const origin = next.startLineNumber - 1 + next.startLineFraction
      const pixelRatio = renderLayout.canvasInnerHeight / renderLayout.canvasOuterHeight
      const rowUnderSlider = origin + (next.sliderTop * pixelRatio) / renderLayout.lineHeight
      expect(rowUnderSlider).toBeCloseTo(current.scrollRow, 10)
      expect(next.startLineFraction).toBeGreaterThanOrEqual(0)
      expect(next.startLineFraction).toBeLessThan(1)
      expect(
        (next.endLineNumber - next.startLineNumber + 1 - next.startLineFraction) *
          renderLayout.lineHeight,
      ).toBeGreaterThanOrEqual(renderLayout.canvasInnerHeight)
      if (previous) {
        expect(origin).toBeGreaterThan(previousOrigin)
        expect(origin - previousOrigin).toBeLessThan(0.1)
      }
      previous = next
      previousOrigin = origin
    }
  })

  it('uses document bounds even when a gap advances the display range', () => {
    const metrics = { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 }
    const current = viewport({
      clientHeight: 85,
      scrollHeight: 40_000,
      scrollTop: 2800,
      scrollRow: 137.25,
      visibleStart: 138,
    })
    const renderLayout = computeRenderLayout({
      minimap: resolveMinimapOptions(),
      metrics,
      viewport: current,
      lineCount: 2000,
    })
    const frame = computeFrameLayout({
      renderLayout,
      metrics,
      viewport: current,
      lineCount: 2000,
      realLineCount: 2000,
      previous: null,
    })
    const rowUnderSlider =
      frame.startLineNumber -
      1 +
      frame.startLineFraction +
      frame.sliderTop / renderLayout.lineHeight
    expect(rowUnderSlider).toBeCloseTo(138, 10)
  })
})

function viewport(overrides: Partial<MinimapViewport> = {}): MinimapViewport {
  return {
    scrollTop: 0,
    scrollRow: 0,
    scrollLeft: 0,
    scrollHeight: 1000,
    scrollWidth: 800,
    clientHeight: 600,
    clientWidth: 800,
    minimapHeight: overrides.clientHeight ?? 600,
    reservedWidth: 0,
    visibleStart: 0,
    visibleEnd: 30,
    ...overrides,
  }
}
