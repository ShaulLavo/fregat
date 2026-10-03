import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import { describe, expect, it } from 'vitest'
import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { resolveMinimapOptions } from '../src/options'
import { MinimapWorkerRenderer } from '../src/renderer'
import {
  canUseMinimapWorker,
  MinimapWorkerClient,
  MinimapWorkerOwner,
  type MinimapHost,
} from '../src/workerClient'

describe.skipIf(!canUseMinimapWorker())('MinimapWorkerClient', () => {
  it('renders through OffscreenCanvas and updates host layout', async () => {
    const host = createHost()
    const client = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions(),
      snapshot: snapshot('const value = 1;\nconsole.log(value);'),
      decorations: [],
      onLayoutWidth: (width) => {
        host.root.dataset.width = String(width)
      },
      reservedLane: () => 0,
    })

    await waitFor(() => Number(host.root.dataset.width) > 0 && host.slider.style.display !== '')

    expect(Number(host.root.dataset.width)).toBeGreaterThan(0)
    expect(host.slider.style.display).toMatch(/block|none/)

    client.dispose()
    expect(client.inspectWorker().lifecycle).toBe('disposed')
    host.root.remove()
    host.colorScope.remove()
  })

  it.each([1, 1.25, 2])('paints long lines to the right edge beneath markers at DPR %s', (dpr) => {
    const renderer = new MinimapWorkerRenderer()
    const mainCanvas = new OffscreenCanvas(1, 1)
    const decorationsCanvas = new OffscreenCanvas(1, 1)
    const options = resolveMinimapOptions({ renderCharacters: false })
    renderer.init({
      mainCanvas,
      decorationsCanvas,
      options,
      styles: {
        background: { r: 0, g: 0, b: 0, a: 255 },
        foreground: { r: 255, g: 255, b: 255, a: 255 },
        foregroundOpacity: 1,
        selection: { r: 0, g: 0, b: 255, a: 255 },
        minimapBackground: { r: 0, g: 0, b: 0, a: 0 },
        slider: 'transparent',
        sliderHover: 'transparent',
        sliderActive: 'transparent',
        fontFamily: 'monospace',
      },
    })
    const text = 'X'.repeat(options.maxColumn)
    renderer.setDocument({
      textLength: text.length,
      lineStarts: [0],
      lines: [{ text, length: text.length }],
      tokens: [],
      selections: [],
      decorations: [],
    })
    renderer.updateLayout(
      { rowHeight: 20, characterWidth: 8, devicePixelRatio: dpr },
      {
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 80,
        scrollWidth: 2000,
        clientHeight: 80,
        clientWidth: 2000,
        minimapHeight: 80,
        reservedWidth: 0,
        visibleStart: 0,
        scrollRow: 0,
        visibleEnd: 1,
      },
    )

    try {
      renderer.render()
      const codeBefore = rightmostPixel(mainCanvas)
      expect(codeBefore?.[3]).toBeGreaterThan(0)
      expect(rightmostPixel(decorationsCanvas)?.[3]).toBe(0)

      renderer.setExternalDecorations([
        {
          startLineNumber: 1,
          endLineNumber: 1,
          startColumn: 1,
          endColumn: text.length + 1,
          position: 'gutter',
          color: '#ff0000',
        },
      ])
      renderer.render()

      expect(rightmostPixel(mainCanvas)).toEqual(codeBefore)
      const marker = rightmostPixel(decorationsCanvas)
      expect(marker?.[0]).toBe(255)
      expect(marker?.[1]).toBe(0)
      expect(marker?.[3]).toBeGreaterThan(0)
    } finally {
      renderer.dispose()
    }
  })
})

describe.skipIf(typeof Worker === 'undefined')('MinimapWorkerOwner disposal', () => {
  it.each(['idle', 'busy'])('settles disposal of a silent %s browser worker', async (mode) => {
    const url = URL.createObjectURL(
      new Blob(
        [
          `
      onmessage = () => {
        postMessage({ type: 'rendered', sequence: 1, sliderNeeded: false,
          sliderTop: 0, sliderHeight: 0, shadowVisible: false });
        ${mode === 'busy' ? 'while (true) {}' : ''}
      };
    `,
        ],
        { type: 'text/javascript' },
      ),
    )
    const worker = new Worker(url)
    let running = false
    const owner = new MinimapWorkerOwner({
      workerFactory: () => worker,
      onMessage: () => {
        running = true
      },
    })

    try {
      owner.post({ type: 'render', sequence: 1 })
      await waitFor(() => running)
      let settled = false
      const disposal = owner.dispose().then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(true)
      await disposal
      expect(owner.inspect().lifecycle).toBe('disposed')
      expect(worker.onmessage).toBeNull()
      expect(worker.onerror).toBeNull()
    } finally {
      worker.terminate()
      URL.revokeObjectURL(url)
    }
  })
})

function rightmostPixel(canvas: OffscreenCanvas): Uint8ClampedArray | undefined {
  return canvas.getContext('2d')?.getImageData(canvas.width - 1, 0, 1, 1).data
}

function createHost(): MinimapHost {
  const root = document.createElement('div')
  const colorScope = document.createElement('div')
  const shadow = document.createElement('div')
  const mainCanvas = document.createElement('canvas')
  const decorationsCanvas = document.createElement('canvas')
  const slider = document.createElement('div')
  const sliderHorizontal = document.createElement('div')
  root.style.fontFamily = 'monospace'
  root.style.color = 'rgb(212, 212, 212)'
  root.style.backgroundColor = 'rgb(30, 30, 30)'
  colorScope.style.fontFamily = 'monospace'
  colorScope.style.color = 'rgb(212, 212, 212)'
  colorScope.style.backgroundColor = 'rgb(30, 30, 30)'
  colorScope.style.setProperty('--editor-syntax-keyword', '#ff0000')
  slider.appendChild(sliderHorizontal)
  root.append(shadow, mainCanvas, decorationsCanvas, slider)
  document.body.append(colorScope, root)
  return { root, colorScope, shadow, mainCanvas, decorationsCanvas, slider, sliderHorizontal }
}

function snapshot(text: string): EditorViewSnapshot {
  return {
    documentId: 'test.ts',
    languageId: 'typescript',
    ...createTestViewSnapshotSource(text),
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
    lineStarts: lineStarts(text),
    tokens: EditorTokenStore.fromTokens([
      { start: 0, end: 5, style: { color: 'var(--editor-syntax-keyword)' } },
    ]),
    brackets: [],
    selections: [
      { anchorOffset: 0, headOffset: 5, startOffset: 0, endOffset: 5, affinity: 'after' },
    ],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 2,
    contentWidth: 160,
    totalHeight: 40,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollTop: 0,
      scrollRow: 0,
      scrollLeft: 0,
      scrollHeight: 40,
      scrollWidth: 160,
      clientHeight: 200,
      clientWidth: 400,
      borderBoxHeight: 200,
      borderBoxWidth: 400,
      visibleRange: { start: 0, end: 2 },
    },
    toVisibleSnapshot() {
      return null
    },
  }
}

function lineStarts(text: string): readonly number[] {
  const starts = [0]
  let index = text.indexOf('\n')
  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf('\n', index + 1)
  }
  return starts
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for minimap worker')
}
