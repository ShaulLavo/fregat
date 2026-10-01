import { afterAll, beforeAll, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import type { RenderRow } from '../../core/types.js'
import { CanvasGlyphRasterizer } from '../atlas/canvas-rasterizer.js'
import { CanvasTerminalRenderer } from '../canvas/renderer.js'
import { WebGpuTerminalRenderer } from '../renderer.js'
import { WebGlTerminalRenderer } from '../webgl/renderer.js'
import { fittedFont, rgb, TestClock } from '../webgl/tests/fixture.js'

const font = fittedFont(24, 48, 32)
const columns = 26
const rows = 3
const emojiText = '👩‍💻 👨‍👩‍👧‍👦 🧪 💻'
const background = rgb(16, 16, 16)
const foreground = rgb(0, 255, 255)
const viewport = { width: window.innerWidth, height: window.innerHeight }

beforeAll(() => page.viewport(800, 600))
afterAll(() => page.viewport(viewport.width, viewport.height))

it.each(['⚫', '⚪', '💻', '👩‍💻', '👨‍👩‍👧‍👦', '🧪'])('retains intrinsic emoji colors for %s', (text) => {
  const rasterizer = new CanvasGlyphRasterizer({ font })
  const bitmap = rasterizer.rasterize({ cellSpan: 2, italic: false, text, weight: 'normal' })
  expect(bitmap).toBeDefined()
  expect(bitmap!.kind).toBe('color')
  expect(bitmap!.pixels.some((value, offset) => offset % 4 === 3 && value > 0)).toBe(true)
})

function referenceCanvas(renderRows: readonly RenderRow[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = columns * font.deviceCellWidth
  canvas.height = rows * font.deviceCellHeight
  const context = canvas.getContext('2d')!
  context.fillStyle = '#101010'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.font = `400 ${font.settings.size}px ${font.settings.family}`
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.fillStyle = '#00ffff'
  for (const row of renderRows) {
    for (const cell of row.cells) {
      if (cell.continuation || !cell.text) continue
      const span = row.cells[cell.x + 1]?.continuation ? 2 : 1
      context.fillText(
        cell.text,
        (cell.x + span / 2) * font.deviceCellWidth,
        row.y * font.deviceCellHeight + font.deviceBaseline,
      )
    }
  }
  return canvas
}

async function displayedPixels(canvas: HTMLCanvasElement): Promise<Uint8ClampedArray> {
  const screenshot = await page.screenshot({ element: canvas, save: false, scale: 'css' })
  const image = new Image()
  image.src = `data:image/png;base64,${screenshot}`
  await image.decode()
  const decoded = document.createElement('canvas')
  decoded.width = image.naturalWidth
  decoded.height = image.naturalHeight
  const context = decoded.getContext('2d')!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, decoded.width, decoded.height).data
}

function mismatchedPixels(actual: Uint8ClampedArray, expected: Uint8ClampedArray): number {
  expect(actual.length).toBe(expected.length)
  let mismatches = 0
  for (let offset = 0; offset < actual.length; offset += 4) {
    const difference = Math.max(
      Math.abs(actual[offset]! - expected[offset]!),
      Math.abs(actual[offset + 1]! - expected[offset + 1]!),
      Math.abs(actual[offset + 2]! - expected[offset + 2]!),
    )
    if (difference > 8) mismatches += 1
  }
  return mismatches
}

it.each([
  ['webgpu', WebGpuTerminalRenderer],
  ['webgl2', WebGlTerminalRenderer],
  ['canvas2d', CanvasTerminalRenderer],
] as const)('presents legacy and clustered ZWJ emoji through %s', async (backend, Renderer) => {
  const runtime = await GhosttyRuntime.create()
  const terminal = runtime.createTerminal({ columns, rows })
  const state = runtime.createRenderState(terminal)
  const canvas = document.createElement('canvas')
  canvas.style.backgroundColor = '#101010'
  const fixture = document.createElement('div')
  document.body.append(fixture)
  let renderer: Awaited<ReturnType<typeof Renderer.create>> | undefined
  try {
    terminal.write(`\x1b[?25l${emojiText}\r\n\x1b[?2027h${emojiText}\r\n⚫ ⚪ 🧪 💻`)
    state.update()
    const renderRows = state.readRows()
    expect(renderRows[0]!.cells[0]!.text).toBe('👩‍')
    expect(renderRows[0]!.cells[2]!.text).toBe('💻')
    expect(renderRows[1]!.cells[0]!.text).toBe('👩‍💻')
    expect(renderRows[1]!.cells[3]!.text).toBe('👨‍👩‍👧‍👦')
    expect(renderRows[1]!.cells[1]!.continuation).toBe(true)
    expect(renderRows[1]!.cells[4]!.continuation).toBe(true)
    const reference = referenceCanvas(renderRows)
    const label = document.createElement('p')
    label.textContent = `${backend} / direct Canvas2D. Rows: legacy, mode 2027, achromatic controls.`
    fixture.append(label, canvas, reference)
    const clock = new TestClock()
    renderer = await Renderer.create({
      canvas,
      columns,
      font,
      renderState: state,
      rows,
      schedulerClock: clock,
      theme: { background, foreground, minimumContrast: 1 },
    })
    clock.flushFrame()
    await page.screenshot({
      element: fixture,
      path: `../../../.artifacts/emoji-${backend}.png`,
      scale: 'css',
    })
    const actual = await displayedPixels(canvas)
    const expected = await displayedPixels(reference)
    expect(mismatchedPixels(actual, expected)).toBeLessThan(40)
  } finally {
    renderer?.dispose()
    runtime.dispose()
    fixture.remove()
  }
})
