import { Editor } from '@singapore-editor/core/editor'
import { createError } from '@singapore-editor/core/logging/evlog'
import type { EditorToken } from '@singapore-editor/core/syntax'
import '@singapore-editor/core/style.css'
import { createMinimapPlugin } from '../src/index'
import { MinimapWorkerClient } from '../src/workerClient'

type Diagnostic = {
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

type Sample = {
  readonly at: number
  readonly scrollTop: number
  readonly durationMs: number
}

const inputs: Sample[] = []
const updates: (Sample & { readonly kind: string })[] = []
const diagnostics: (Diagnostic & { readonly at: number })[] = []
const originalUpdate = MinimapWorkerClient.prototype.update
let editor: Editor | null = null
let lineStarts: number[] = []

MinimapWorkerClient.prototype.update = function (...args) {
  const at = epoch()
  originalUpdate.apply(this, args)
  updates.push({
    at,
    scrollTop: args[0].viewport.scrollTop,
    kind: args[1],
    durationMs: epoch() - at,
  })
}

const originalViewportUpdate = MinimapWorkerClient.prototype.updateViewport
if (typeof originalViewportUpdate === 'function')
  MinimapWorkerClient.prototype.updateViewport = function (viewport) {
    const at = epoch()
    originalViewportUpdate.call(this, viewport)
    updates.push({ at, scrollTop: viewport.scrollTop, kind: 'viewport', durationMs: epoch() - at })
  }

Object.assign(globalThis, {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__: (diagnostic: Diagnostic) => {
    if (diagnostics.length >= 20_000) return
    diagnostics.push({ ...diagnostic, at: epoch() })
  },
})

function epoch(): number {
  return performance.timeOrigin + performance.now()
}

function current(): Editor {
  if (editor) return editor
  throw createError({ message: 'Benchmark editor is not mounted', code: 'MINIMAP_BENCH_STATE' })
}

function prepare(minimap = true, lines = 20_000): void {
  editor?.dispose()
  const host = document.querySelector<HTMLElement>('#editor')
  if (!host) throw createError({ message: 'Missing benchmark host', code: 'MINIMAP_BENCH_HOST' })
  host.replaceChildren()
  const text = patternedText(lines)
  editor = new Editor(host, {
    defaultText: text,
    lineHeight: 20,
    plugins: minimap ? [createMinimapPlugin({ showSlider: 'always' })] : [],
  })
  reset()
}

function patternedText(lines: number): string {
  lineStarts = []
  const rows: string[] = []
  let offset = 0
  for (let line = 0; line < lines; line++) {
    const width = 4 + ((Math.imul(line + 1, 1103515245) >>> 16) % 100)
    const row = `${String(line).padStart(5, '0')} ${'M'.repeat(width)}\n`
    lineStarts.push(offset)
    rows.push(row)
    offset += row.length
  }
  return rows.join('')
}

function reset(): void {
  inputs.length = 0
  updates.length = 0
  diagnostics.length = 0
}

function scroll(scrollTop: number): Sample {
  const at = epoch()
  current().setScrollPosition({ top: scrollTop })
  const sample = { at, scrollTop: current().getScrollPosition().top, durationMs: epoch() - at }
  if (Math.abs(sample.scrollTop - scrollTop) > 1)
    throw createError({
      message: 'Scroll input did not reach the requested position',
      code: 'MINIMAP_BENCH_SCROLL',
      why: `${scrollTop} requested, ${sample.scrollTop} observed`,
    })
  inputs.push(sample)
  return sample
}

function tokensForViewport(index: number): readonly EditorToken[] {
  const first = Math.floor(current().getScrollPosition().top / 20)
  const tokens: EditorToken[] = []
  for (let line = first; line < first + 50; line++) {
    const start = lineStarts[line]
    if (start === undefined) continue
    tokens.push({
      start,
      end: start + 5,
      style: { color: index % 2 === 0 ? '#ffffff' : '#c0c0c0' },
    })
  }
  return tokens
}

async function run(options: { steps: number; stepPx: number; tokenEvery: number }) {
  const frames: number[] = []
  let previous = await nextFrame()
  for (let index = 0; index < options.steps; index++) {
    scroll(6000 + options.stepPx * index)
    if (options.tokenEvery > 0 && index % options.tokenEvery === 0)
      current().setTokens(tokensForViewport(index))
    const now = await nextFrame()
    frames.push(now - previous)
    previous = now
  }
  return { frames, ...report() }
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

function report() {
  return { inputs: [...inputs], updates: [...updates], diagnostics: [...diagnostics] }
}

async function pixels() {
  const { runRasterPixelOracle } = await import('../test/raster-pixel-oracle')
  return runRasterPixelOracle()
}

const bridge = { prepare, reset, scroll, run, report, pixels }
Object.assign(globalThis, { __minimapBench: bridge })
