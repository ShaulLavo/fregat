import { expect, it, onTestFinished, vi } from 'vitest'
import { GhosttyRuntime } from '../src/core/runtime.js'
import { fitTerminalFont } from '../src/dom/fit.js'
import { CanvasTerminalRenderer } from '../src/render/canvas/renderer.js'
import { measuredRenderState } from './native-state.js'
import { createBenchmarkRenderer, parseBenchmarkBackend } from './renderer-factory.js'

const cases = [
  { backend: 'webgpu', path: 'instanced', dispatches: false },
  { backend: 'webgpu-compute', path: 'compute', dispatches: true },
  { backend: 'webgpu-fullscreen-fragment', path: 'fullscreen-fragment', dispatches: false },
] as const

it.each(cases)('benchmarks $backend with native frames and no idle work', async (sample) => {
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
  const renderer = created.renderer
  terminal.write('Hi')
  renderer.notifyWrite()
  await vi.waitFor(() => expect(renderer.metrics.submittedFrames).toBeGreaterThan(0))
  expect(errors).toEqual([])
  const dispatches: unknown = Reflect.get(renderer.metrics, 'dispatches')
  expect(typeof dispatches).toBe('number')
  expect(Number(dispatches) > 0).toBe(sample.dispatches)
  const submitted = renderer.metrics.submittedFrames
  await new Promise((resolve) => setTimeout(resolve, 80))
  expect(renderer.metrics.submittedFrames).toBe(submitted)
  expect(renderer.hasPendingFrame).toBe(false)
})

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
