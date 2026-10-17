import { expect, it, onTestFinished, vi } from 'vitest'
import { GhosttyRuntime } from '../src/core/runtime.js'
import { fitTerminalFont } from '../src/dom/fit.js'
import { CanvasTerminalRenderer } from '../src/render/canvas/renderer.js'
import { measuredRenderState } from './native-state.js'
import { createBenchmarkRenderer, parseBenchmarkBackend } from './renderer-factory.js'

const cases = [
  { backend: 'webgpu', path: 'instanced', dispatches: false, textureCopies: false },
  { backend: 'webgpu-compute', path: 'compute', dispatches: true, textureCopies: false },
  {
    backend: 'webgpu-compute-copy',
    path: 'compute-copy',
    dispatches: true,
    textureCopies: true,
  },
  {
    backend: 'webgpu-fullscreen-fragment',
    path: 'fullscreen-fragment',
    dispatches: false,
    textureCopies: false,
  },
] as const

for (const sample of cases) {
  it(`benchmarks ${sample.backend} with native frames and no idle work`, async (context) => {
    if (sample.backend === 'webgpu-compute-copy') {
      if (!navigator.gpu) {
        context.skip('WebGPU is unavailable')
        return
      }
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        context.skip('No WebGPU adapter is available')
        return
      }
      const format = navigator.gpu.getPreferredCanvasFormat()
      if (format === 'bgra8unorm' && !adapter.features.has('bgra8unorm-storage')) {
        context.skip('The adapter lacks bgra8unorm-storage')
        return
      }
    }
    const runtime = await GhosttyRuntime.create()
    let created: Awaited<ReturnType<typeof createBenchmarkRenderer>> | undefined
    onTestFinished(async () => {
      await created?.renderer.dispose()
      runtime.dispose()
    })
    const font = fitTerminalFont(
      document,
      {
        boldWeight: 700,
        family: 'monospace',
        letterSpacing: 0,
        lineHeight: 1.2,
        size: 13,
        weight: 400,
      },
      1,
    )
    const terminal = runtime.createTerminal({
      columns: 4,
      rows: 2,
      cellWidth: font.deviceCellWidth,
      cellHeight: font.deviceCellHeight,
    })
    const state = runtime.createRenderState(terminal)
    const decoded = { rows: 0, cells: 0 }
    const renderState = measuredRenderState(state, decoded)
    const builder = renderState.createFrameBuilder?.(4, 2)
    expect(builder?.columns).toBe(4)
    builder?.dispose()
    const errors: unknown[] = []
    const canvas = document.createElement('canvas')
    const backend = parseBenchmarkBackend(sample.backend)
    if (backend === 'ghostty-web') throw new Error('Native backend required')
    created = await createBenchmarkRenderer(backend, {
      canvas,
      columns: 4,
      rows: 2,
      font,
      renderState,
      onError: (cause) => errors.push(cause),
      onFrame: () => {},
      needsFrameRows: () => false,
    })
    expect(created.path).toBe(sample.path)
    expect(created.adapter).toHaveProperty('preferredCanvasFormat')
    expect(created.adapter).toHaveProperty('bgra8unormStorageEnabled')
    const renderer = created.renderer
    terminal.write('Hi')
    renderer.notifyWrite()
    await vi.waitFor(() => expect(renderer.metrics.submittedFrames).toBeGreaterThan(0))
    expect(errors).toEqual([])
    const dispatches: unknown = Reflect.get(renderer.metrics, 'dispatches')
    expect(typeof dispatches).toBe('number')
    expect(Number(dispatches) > 0).toBe(sample.dispatches)
    const textureCopies: unknown = Reflect.get(renderer.metrics, 'textureCopies')
    expect(typeof textureCopies).toBe('number')
    expect(Number(textureCopies) > 0).toBe(sample.textureCopies)
    if (sample.textureCopies) expect(Reflect.get(renderer.metrics, 'draws')).toBe(0)
    const submitted = renderer.metrics.submittedFrames
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(renderer.metrics.submittedFrames).toBe(submitted)
    expect(renderer.hasPendingFrame).toBe(false)
  })
}

it('selects the canvas pixel backend in the benchmark factory', async () => {
  const runtime = await GhosttyRuntime.create()
  let created: Awaited<ReturnType<typeof createBenchmarkRenderer>> | undefined
  onTestFinished(async () => {
    await created?.renderer.dispose()
    runtime.dispose()
  })
  const font = fitTerminalFont(
    document,
    {
      boldWeight: 700,
      family: 'monospace',
      letterSpacing: 0,
      lineHeight: 1.2,
      size: 13,
      weight: 400,
    },
    1,
  )
  const terminal = runtime.createTerminal({ columns: 4, rows: 2 })
  const state = runtime.createRenderState(terminal)
  created = await createBenchmarkRenderer('canvas2d-pixels', {
    canvas: document.createElement('canvas'),
    columns: 4,
    rows: 2,
    font,
    renderState: measuredRenderState(state, { rows: 0, cells: 0 }),
  })
  expect(created.path).toBe('pixels')
  expect(created.renderer).toBeInstanceOf(CanvasTerminalRenderer)
  expect(Reflect.get(created.renderer, 'canvasPaintMode')).toBe('pixels')
})
