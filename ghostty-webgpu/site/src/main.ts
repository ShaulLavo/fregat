import { fitTerminalFont, Terminal } from '../../dist/index.js'
import { GhostDemo } from './demos/ghost.js'
import type { DemoContext } from './demos/types.js'
import { terminalTheme } from './theme.js'
import { loadGhostFrames } from './ghost-frames.js'

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
const BASE_FONT_SIZE = 14
const BASE_LINE_HEIGHT = 1.1
// A touch smaller than ghostty.org's 12px, which also opens room for the sideways drift.
const FIT_FONT_SIZE = 10
const FIT_LINE_HEIGHT = 1
const MIN_FONT_SIZE = 5
const MAX_SCREEN_VIEWPORT_SHARE = 0.8
const PHONE_SCREEN_VIEWPORT_SHARE = 0.45
const PADDING = { bottom: 12, left: 16, right: 16, top: 12 }
const ghost = new GhostDemo()

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new TypeError(`Missing element: ${selector}`)
  return element
}

const ui = {
  backend: required<HTMLElement>('#backend'),
  backendFact: required<HTMLElement>('#backend-fact'),
  copy: required<HTMLButtonElement>('#copy-install'),
  firstFrame: required<HTMLElement>('#ghost-first-frame'),
  wasmUnavailable: required<HTMLElement>('#wasm-unavailable'),
  host: required<HTMLElement>('#terminal'),
  screen: required<HTMLElement>('.screen'),
  stat: required<HTMLElement>('#stat'),
  window: required<HTMLElement>('#window'),
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let terminal: Terminal | undefined
const paused = reducedMotion.matches

async function loadFonts(): Promise<void> {
  if (!('fonts' in document)) return
  await Promise.all([
    document.fonts.load(`400 14px ${FONT_FAMILY}`),
    document.fonts.load(`600 14px ${FONT_FAMILY}`),
    document.fonts.load(`italic 400 14px ${FONT_FAMILY}`),
  ]).catch(() => undefined)
}

function createContext(instance: Terminal): DemoContext {
  return {
    grid: () => ({
      cols: instance.appearance.grid.columns,
      rows: instance.appearance.grid.rows,
    }),
    stat: (text) => {
      ui.stat.textContent = text
    },
    write: (data) => {
      instance.write(data)
    },
  }
}

/** Measure the candidate font with the same pixel rounding as the renderer. */
function cellSize(size: number): { readonly height: number; readonly width: number } {
  const font = fitTerminalFont(
    document,
    { ...terminal!.appearance.font, lineHeight: FIT_LINE_HEIGHT, size },
    window.devicePixelRatio,
  )
  return { height: font.cssCellHeight, width: font.cssCellWidth }
}

/** Sizes the window and font so a grid shows whole; undefined restores base. */
function fitTo(grid: { readonly cols: number; readonly rows: number } | undefined): void {
  if (!terminal) return
  if (!grid) {
    ui.screen.style.height = ''
    setFont(BASE_FONT_SIZE, BASE_LINE_HEIGHT)
    return
  }
  const scrollbarWidth = ui.host.querySelector<HTMLElement>('[role="scrollbar"]')?.offsetWidth ?? 0
  const width = ui.host.clientWidth - PADDING.left - PADDING.right - scrollbarWidth
  const share = window.innerWidth < 480 ? PHONE_SCREEN_VIEWPORT_SHARE : MAX_SCREEN_VIEWPORT_SHARE
  const maxHeight = window.innerHeight * share - PADDING.top - PADDING.bottom
  let size = FIT_FONT_SIZE
  let cell = cellSize(size)
  while (
    size > MIN_FONT_SIZE &&
    (grid.cols * cell.width > width || grid.rows * cell.height > maxHeight)
  ) {
    size -= 1
    cell = cellSize(size)
  }
  const rowsHeight = Math.ceil(grid.rows * cell.height)
  ui.screen.style.height = `${rowsHeight + PADDING.top + PADDING.bottom}px`
  setFont(size, FIT_LINE_HEIGHT)
}

function setFont(size: number, lineHeight: number): void {
  const current = terminal!.appearance.font
  if (current.size === size && current.lineHeight === lineHeight) return
  terminal!.setFont({ lineHeight, size })
}

function wireControls(): void {
  // The terminal's own wheel handler scrolls its scrollback and blocks the
  // page. Stop the event in the capture phase so the page scrolls instead.
  ui.host.addEventListener('wheel', (event) => event.stopPropagation(), { capture: true })
  ui.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('npm install ghostty-webgpu')
      ui.copy.textContent = 'Copied'
    } catch {
      ui.copy.textContent = 'Select and copy'
    }
    window.setTimeout(() => {
      ui.copy.textContent = 'Copy'
    }, 1600)
  })
  window.addEventListener('resize', () => {
    fitTo(ghost.fit)
  })
  document.addEventListener('visibilitychange', () => {
    if (paused) return
    ghost.setPaused(document.hidden)
  })
}

async function boot(): Promise<void> {
  wireControls()
  if (typeof WebAssembly === 'undefined') {
    ui.wasmUnavailable.hidden = false
    return
  }
  const fonts = loadFonts().then(() => performance.mark('ghost:fonts-ready'))
  const frames = loadGhostFrames()
  const frame = ui.firstFrame.querySelector('.ghostty-webgpu-frame')!
  const firstFontSize = Number.parseFloat(getComputedStyle(frame).fontSize)
  const base = document.baseURI
  performance.mark('ghost:create-start')
  const creating = Terminal.create({
    appearance: {
      cursor: { blink: true, style: 'block' },
      font: { family: FONT_FAMILY, lineHeight: FIT_LINE_HEIGHT, size: firstFontSize },
      scrollbackLimit: 2000,
      theme: terminalTheme(),
    },
    padding: PADDING,
    runtime: {
      kind: 'owned',
      options: {
        bridge: new URL('bridge.wasm', base),
        wasm: new URL('ghostty-vt.wasm', base),
      },
    },
  })
  const created = creating.then((instance) => {
    performance.mark('ghost:create-resolved')
    return instance
  })
  const [instance, , loadedFrames] = await Promise.all([created, fonts, frames])
  await instance.open(ui.host)
  performance.mark('ghost:open-resolved')
  terminal = instance

  const backend = instance.diagnostics.rendererBackend ?? 'unknown'
  ui.backend.textContent = backend
  ui.backendFact.textContent = backend
  ui.window.dataset['ready'] = 'true'

  instance.onResize(() => ghost.resize())
  // Avoid announcing every frame of the decorative animation.
  instance.setAccessibilityEnabled(false)
  fitTo(ghost.fit)
  ghost.prepare(loadedFrames)
  ghost.setPaused(true)
  const firstPaint = instance.onFrame(() => {
    firstPaint.dispose()
    requestAnimationFrame(() => {
      ui.firstFrame.remove()
      performance.mark('ghost:first-frame')
      ghost.setPaused(paused || document.hidden)
    })
  })
  ghost.start(createContext(instance))
}

boot().catch((cause: unknown) => {
  console.error('Live ghost animation failed to start', cause)
})
