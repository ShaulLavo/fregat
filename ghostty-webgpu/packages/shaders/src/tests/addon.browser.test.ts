import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import {
  GhosttyRuntime,
  Terminal,
  WebGpuTerminalRenderer,
  type GhosttyWebGpuRendererFactory,
} from '../../../../dist/index.js'
import { WebGlTerminalRenderer } from '../../../../dist/render/webgl/renderer.js'
import { CanvasTerminalRenderer } from '../../../../dist/render/canvas/renderer.js'
import { createShaderAddon, type CompiledShader } from '../../dist/index.js'
import { copyShader, greenShader, language, uniformShader, timeShader } from './artifacts.js'

const cleanups: (() => unknown)[] = []
let runtime: GhosttyRuntime
beforeAll(async () => {
  runtime = await GhosttyRuntime.create()
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
afterAll(() => runtime.dispose())

function factory(backend: 'webgpu' | 'webgl2' | 'canvas2d'): GhosttyWebGpuRendererFactory {
  if (backend === 'webgpu')
    return (options) => WebGpuTerminalRenderer.create({ ...options, adapterPolicy: 'any' })
  if (backend === 'webgl2') return (options) => WebGlTerminalRenderer.create(options)
  return (options) => CanvasTerminalRenderer.create(options)
}

async function fixture(
  backend: 'webgpu' | 'webgl2' | 'canvas2d',
  shader: CompiledShader = copyShader,
  beforeOpen = false,
  output?: 'webgpu' | 'webgl2',
) {
  const host = document.createElement('div')
  host.style.cssText = 'width:340px;height:180px'
  document.body.append(host)
  cleanups.push(() => host.remove())
  const terminal = await Terminal.create({
    appearance: {
      grid: { columns: 10, rows: 3, pixelRatio: 2 },
      cursor: { blink: false },
      font: { family: 'monospace', size: 16 },
    },
    padding: { top: 9, left: 13, bottom: 4, right: 6 },
    fitEnvironment: {
      requestFrame: () => 0,
      cancelFrame: () => {},
      getPixelRatio: () => 2,
      subscribePixelRatio: () => () => {},
      createResizeObserver: () => ({ observe: () => {}, disconnect: () => {} }),
    },
    rendererFactory: factory(backend),
    runtime: { kind: 'borrowed', runtime },
  })
  cleanups.push(() => terminal.dispose())
  const errors: unknown[] = []
  terminal.on('error', (event) => errors.push(event))
  const addon = createShaderAddon(shader, {
    backend: output,
    onError: (error) => errors.push(error),
  })
  if (!beforeOpen) await terminal.open(host)
  const handle = terminal.use(addon)
  cleanups.push(() => handle.dispose())
  if (beforeOpen) await terminal.open(host)
  await handle.api.ready
  terminal.write('\x1b[?25l\x1b[41m          \r\n\x1b[42m          \r\n\x1b[44m          ')
  await expect
    .poll(
      () =>
        terminal.element?.querySelector<HTMLCanvasElement>('[data-ghostty-shader]')?.style.display,
    )
    .toBe('block')
  const canvas = terminal.element?.querySelector<HTMLCanvasElement>('[data-ghostty-shader]')
  if (!canvas) throw new TypeError('Missing shader output')
  return { terminal, canvas, handle, errors, host }
}

async function pixels(canvas: HTMLCanvasElement): Promise<ImageData> {
  const png = await page.screenshot({ element: canvas, save: false })
  const image = new Image()
  image.src = `data:image/png;base64,${png}`
  await image.decode()
  const read = document.createElement('canvas')
  read.width = image.naturalWidth
  read.height = image.naturalHeight
  const context = read.getContext('2d')
  if (!context) throw new TypeError('Missing pixel reader')
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, read.width, read.height)
}
function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4
  return Array.from(image.data.subarray(offset, offset + 3))
}
async function color(canvas: HTMLCanvasElement): Promise<number[]> {
  return pixel(await pixels(canvas), 0.5, 0.5)
}

it.each(['webgpu', 'webgl2'] satisfies ('webgpu' | 'webgl2')[])(
  'captures top and bottom source colors with default full artifacts on %s',
  async (backend) => {
    const f = await fixture(backend, copyShader, true)
    expect(f.canvas.dataset['backend']).toBe(backend)
    const image = await pixels(f.canvas)
    const top = pixel(image, 0.5, 1 / 6)
    const bottom = pixel(image, 0.5, 5 / 6)
    expect(top[0]).toBeGreaterThan(100)
    expect(top[2]).toBeLessThan(30)
    expect(bottom[0]).toBeLessThan(30)
    expect(bottom[2]).toBeGreaterThan(100)
    const source = f.terminal.canvas
    if (!source) throw new TypeError('Missing source')
    const sourceRect = source.getBoundingClientRect()
    const rect = f.canvas.getBoundingClientRect()
    expect(rect.left - sourceRect.left).toBe(13)
    expect(rect.top - sourceRect.top).toBe(9)
    expect(f.canvas.width).toBe(source.width)
    expect(rect.width).toBeCloseTo(sourceRect.width - 19, 0)
    expect(getComputedStyle(f.canvas).pointerEvents).toBe('none')
    f.terminal.focus()
    expect(document.activeElement).toBe(f.terminal.textarea)
    expect(f.errors).toEqual([])
    f.handle.dispose()
    expect(f.canvas.isConnected).toBe(false)
    expect(f.terminal.canvas).toBe(source)
    expect(f.terminal.lifecycle).toBe('open')
    f.terminal.write('still alive')
  },
)

it.each(['webgpu', 'webgl2'] satisfies ('webgpu' | 'webgl2')[])(
  'accepts one-language output, newest wins and failed replacements retain the last shader on %s',
  async (backend) => {
    const f = await fixture(backend, language(copyShader, backend), false, backend)
    const first = f.handle.api.setShader(language(copyShader, backend))
    const latest = f.handle.api.setShader(language(greenShader, backend))
    expect(await first).toBe(false)
    expect(await latest).toBe(true)
    await expect.poll(() => color(f.canvas)).toEqual([0, 255, 0])
    const bad = backend === 'webgpu' ? { wgsl: 'invalid shader' } : { glsl: 'invalid shader' }
    await expect(f.handle.api.setShader(bad)).rejects.toThrow()
    expect(await color(f.canvas)).toEqual([0, 255, 0])
    const missing = backend === 'webgpu' ? { glsl: 'shader' } : { wgsl: 'shader' }
    await expect(f.handle.api.setShader(missing)).rejects.toThrow('requires compiled')
    expect(await color(f.canvas)).toEqual([0, 255, 0])
    expect(f.errors).toEqual([])
  },
)

it.each(['webgpu', 'webgl2'] satisfies ('webgpu' | 'webgl2')[])(
  'updates theme/cursor while paused and cleans terminal disposal on %s',
  async (backend) => {
    const f = await fixture(backend, language(uniformShader, backend), false, backend)
    f.handle.api.setPaused(true)
    f.terminal.setTheme({ ...f.terminal.appearance.theme, background: { r: 128, g: 0, b: 0 } })
    f.terminal.write('\x1b[2J\x1b[H\x1b[?25h')
    f.terminal.focus()
    await expect.poll(() => color(f.canvas)).toEqual([128, 255, 0])
    f.terminal.write('\x1b[2;3H')
    await expect.poll(async () => (await color(f.canvas))[2]).toBeGreaterThan(30)
    f.terminal.setFont({ size: 20 })
    await expect.poll(() => f.canvas.width).toBe(f.terminal.canvas?.width)
    f.terminal.dispose()
    expect(f.canvas.isConnected).toBe(false)
    expect(f.errors).toEqual([])
  },
)

it('freezes effect time while paused, resumes and keeps capture current', async () => {
  const f = await fixture('webgl2', timeShader)
  f.handle.api.setPaused(true)
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
  const paused = await color(f.canvas)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(await color(f.canvas)).toEqual(paused)
  f.handle.api.setPaused(false)
  await expect.poll(async () => (await color(f.canvas))[0]).not.toBe(paused[0])
})

it('follows a replaced terminal canvas during renderer recovery', async () => {
  const f = await fixture('webgl2', copyShader)
  const original = f.terminal.canvas
  const lost = original?.getContext('webgl2')?.getExtension('WEBGL_lose_context')
  if (!lost) throw new TypeError('Missing source loss extension')
  lost.loseContext()
  // The custom factory is intentionally strict; the terminal reports its recovery policy.
  await expect.poll(() => f.terminal.canvas).not.toBe(original)
  f.terminal.write('\x1b[H\x1b[45m          ')
  await expect.poll(async () => pixel(await pixels(f.canvas), 0.5, 1 / 6)[2]).toBeGreaterThan(100)
})

it('disposes during async initialization and keeps the terminal usable', async () => {
  const f = await fixture('webgl2')
  f.handle.dispose()
  const pending = f.terminal.use(createShaderAddon(copyShader, { backend: 'webgpu' }))
  pending.dispose()
  await expect(pending.api.ready).rejects.toThrow('disposed')
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(f.terminal.element?.querySelectorAll('[data-ghostty-shader]').length).toBe(0)
  expect(f.terminal.lifecycle).toBe('open')
})

it('defaults full artifacts to WebGL2 when WebGPU is unavailable, with strict explicit selection', async () => {
  const adapter = vi.spyOn(navigator.gpu, 'requestAdapter').mockResolvedValue(null)
  cleanups.push(() => adapter.mockRestore())
  const f = await fixture('canvas2d', copyShader)
  expect(f.canvas.dataset['backend']).toBe('webgl2')
  const image = await pixels(f.canvas)
  expect(pixel(image, 0.5, 1 / 6)[0]).toBeGreaterThan(100)
  expect(pixel(image, 0.5, 5 / 6)[2]).toBeGreaterThan(100)
  await expect(fixture('canvas2d', copyShader, false, 'webgpu')).rejects.toThrow('unavailable')
  expect(f.errors).toEqual([])
})
