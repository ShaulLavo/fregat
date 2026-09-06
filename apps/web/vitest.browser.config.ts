import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// The browser world lives in its own config on purpose. Vitest merges Vite-level
// options such as `define` across the projects of a single config file, so the
// `VITE_SERVER_URL` this project needs used to rewrite that constant for the
// `node` and `dom` projects too - pointing their client at a file server only
// this run ever spawns. A separate config is the only boundary that holds.
const alias = {
  '@': path.resolve(__dirname, './src'),
}

// A bun-linked package resolves outside the workspace, so Vite's fs allowlist
// blocks the non-JS files it fetches at runtime — ghostty's wasm artifact.
const linkedPackageRoots = ['ghostty-webgpu'].flatMap((name) =>
  [__dirname, path.resolve(__dirname, '../..')].flatMap((base) => {
    const candidate = path.join(base, 'node_modules', name)
    return fs.existsSync(candidate) ? [fs.realpathSync(candidate)] : []
  }),
)
const browserTestPort = process.env.VITEST_BROWSER_PORT ?? '5179'
const browserFileServerPort = process.env.VITEST_BROWSER_FILE_SERVER_PORT ?? '33201'
const browserFileServerUrl = `http://127.0.0.1:${browserFileServerPort}`

process.env.VITEST_BROWSER_PORT = browserTestPort
process.env.VITEST_BROWSER_FILE_SERVER_PORT = browserFileServerPort
process.env.VITEST_BROWSER_FILE_SERVER_URL = browserFileServerUrl

// Real-paint / layout / visual tests in a real browser via Playwright.
export default defineConfig({
  plugins: [react({ compiler: true }), tailwindcss()],
  resolve: { alias, dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: [path.resolve(__dirname, '../..'), ...linkedPackageRoots] } },
  define: {
    // Browser tests talk to the spawned file server directly: the
    // Vitest browser runner serves tests from its own API server, so
    // the project-level `server.proxy` never applies to them.
    'import.meta.env.VITE_SERVER_URL': JSON.stringify(browserFileServerUrl),
    // Opt in explicitly for browser checks that prove the client-to-file drain.
    'import.meta.env.OBSERVABILITY_ENABLED': JSON.stringify(
      process.env.OBSERVABILITY_ENABLED ?? '',
    ),
  },
  optimizeDeps: {
    exclude: ['@singapor/tree-sitter', '@singapor/tree-sitter-languages', 'ghostty-webgpu'],
    include: [
      '@phosphor-icons/react',
      '@tanstack/react-hotkeys',
      '@workspace/ui > @base-ui/react/merge-props',
      '@workspace/ui > @base-ui/react/select',
      '@workspace/ui > @base-ui/react/switch',
      '@workspace/ui > @base-ui/react/use-render',
      '@workspace/ui > cmdk',
    ],
  },
  test: {
    name: 'browser',
    globalSetup: ['./test/env/browser-file-server.ts'],
    include: ['src/**/*.browser.tsx'],
    setupFiles: ['./test/env/jest-dom.ts'],
    browser: {
      // Pin the runner origin so the file server's allowed-origins
      // list (built from this port) matches the real test origin.
      api: { host: '127.0.0.1', port: Number(browserTestPort) },
      commands: {
        diffMouseWheel,
        proofContextClick,
        proofKeyDown,
        proofKeyPress,
        proofKeyUp,
        proofMouseDrag,
        proofMouseHover,
        proofMouseUp,
      },
      enabled: true,
      headless: true,
      // `workbench.colorTheme` defaults to `system`, and these tests
      // assert against the dark editor palette. Headless Chromium reports
      // light unless told otherwise, so the browser itself is the thing to
      // put in dark — then the default setting and a seeded `dark` agree.
      provider: playwright({ contextOptions: { colorScheme: 'dark' } }),
      screenshotFailures: false,
      instances: [{ browser: 'chromium', viewport: { height: 700, width: 900 } }],
    },
  },
})

type ProofMouseCommandContext = {
  readonly frame: () => Promise<ProofMouseFrame>
  readonly page: {
    readonly mouse: {
      readonly click: (
        x: number,
        y: number,
        options?: { readonly button?: 'left' | 'middle' | 'right' },
      ) => Promise<void>
      readonly down: () => Promise<void>
      readonly move: (x: number, y: number, options?: { readonly steps?: number }) => Promise<void>
      readonly up: () => Promise<void>
      readonly wheel: (deltaX: number, deltaY: number) => Promise<void>
    }
  }
}

type ProofKeyCommandContext = {
  readonly page: {
    readonly keyboard: {
      readonly down: (key: string) => Promise<void>
      readonly press: (key: string) => Promise<void>
      readonly up: (key: string) => Promise<void>
    }
  }
}

type ProofKeyPressInput = {
  readonly key: string
}

type ProofContextClickInput = {
  readonly selector: string
}

type DiffMouseWheelInput = {
  readonly deltaX?: number
  readonly deltaY?: number
  readonly selector: string
}

type ProofMouseFrame = {
  readonly evaluate: <TResult>(callback: () => TResult) => Promise<TResult>
  readonly locator: (selector: string) => {
    readonly boundingBox: () => Promise<ProofMouseBox | null>
  }
}

type ProofMouseBox = {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

type ProofMousePoint = {
  readonly x: number
  readonly y: number
}

type ProofMouseFrameTransform = {
  readonly originX: number
  readonly originY: number
  readonly scaleX: number
  readonly scaleY: number
}

type ProofMouseHoverInput = {
  readonly selector: string
  readonly x?: number
  readonly y?: number
}

type ProofMouseDragInput = {
  readonly release?: boolean
  readonly sourceClientX?: number
  readonly sourceClientY?: number
  readonly sourceSelector: string
  readonly sourceX?: number
  readonly sourceY?: number
  readonly steps: readonly ProofMouseDragStep[]
}

type ProofMouseDragStep =
  | {
      readonly dx: number
      readonly dy: number
      readonly kind: 'move-by'
      readonly steps?: number
    }
  | {
      readonly kind: 'move-to-selector'
      readonly offsetX?: number
      readonly offsetY?: number
      readonly selector: string
      readonly steps?: number
      readonly x?: number
      readonly y?: number
    }
  | {
      readonly kind: 'pause'
      readonly ms?: number
    }

async function proofKeyPress(context: ProofKeyCommandContext, input: ProofKeyPressInput) {
  await context.page.keyboard.press(input.key)
}

async function proofKeyDown(context: ProofKeyCommandContext, input: ProofKeyPressInput) {
  await context.page.keyboard.down(input.key)
}

async function proofKeyUp(context: ProofKeyCommandContext, input: ProofKeyPressInput) {
  await context.page.keyboard.up(input.key)
}

async function proofContextClick(context: ProofMouseCommandContext, input: ProofContextClickInput) {
  const frame = await context.frame()
  const transform = await proofMouseFrameTransform(frame)
  const point = await pointForSelector(frame, transform, input.selector)

  await context.page.mouse.click(point.x, point.y, { button: 'right' })
}

/**
 * A real wheel over an element, which nothing reachable from the test page can produce.
 *
 * Split-pane scroll sync exists to be driven by a wheel, and every cheaper way of standing in for
 * one takes a different code path: assigning `element.scrollTop` goes through the property the
 * virtualizer redefines, which folds the offset synchronously, and a synthetic `WheelEvent` is
 * untrusted so the browser refuses to scroll on it. Only the CDP-level wheel behaves like a finger.
 */
async function diffMouseWheel(context: ProofMouseCommandContext, input: DiffMouseWheelInput) {
  const frame = await context.frame()
  const transform = await proofMouseFrameTransform(frame)
  const point = await pointForSelector(frame, transform, input.selector)

  await context.page.mouse.move(point.x, point.y)
  await context.page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 0)
}

/**
 * A real pointer move with no button pressed.
 *
 * `proofMouseDrag` cannot stand in for this: it presses on the way in, and a
 * pressed pointer is a drag, which is a different code path from hover in every
 * editor. Synthetic `mousemove` cannot stand in for it either — the events the
 * editor listens for have to come from the browser to carry real coordinates
 * against real layout.
 */
async function proofMouseHover(context: ProofMouseCommandContext, input: ProofMouseHoverInput) {
  const frame = await context.frame()
  const transform = await proofMouseFrameTransform(frame)
  // Offsets from the element's top-left, not the ratios `pointForSelector` takes
  // by default: a hover targets a specific row, and a ratio cannot name one.
  const point = await pointForSelector(frame, transform, input.selector, 0, 0, input.x, input.y)

  // Two moves: the first can land on the element before its listeners are live,
  // and a hover that never moves again is a hover the editor never sees.
  await context.page.mouse.move(point.x - 1, point.y)
  await context.page.mouse.move(point.x, point.y, { steps: 4 })
}

async function proofMouseDrag(context: ProofMouseCommandContext, input: ProofMouseDragInput) {
  const frame = await context.frame()
  const transform = await proofMouseFrameTransform(frame)
  let point = await sourcePointForProofMouseDrag(frame, transform, input)

  await context.page.mouse.move(point.x, point.y)
  await context.page.mouse.down()

  for (const step of input.steps) {
    point = await runProofMouseStep(context, frame, transform, point, step)
  }

  if (input.release === false) return

  await context.page.mouse.up()
}

async function sourcePointForProofMouseDrag(
  frame: ProofMouseFrame,
  transform: ProofMouseFrameTransform,
  input: ProofMouseDragInput,
) {
  if (typeof input.sourceClientX === 'number' && typeof input.sourceClientY === 'number') {
    return frameClientPointToPagePoint(transform, {
      x: input.sourceClientX,
      y: input.sourceClientY,
    })
  }

  return pointForSelector(frame, transform, input.sourceSelector, input.sourceX, input.sourceY)
}

async function proofMouseUp(context: ProofMouseCommandContext) {
  await context.page.mouse.up()
}

async function runProofMouseStep(
  context: ProofMouseCommandContext,
  frame: ProofMouseFrame,
  transform: ProofMouseFrameTransform,
  currentPoint: ProofMousePoint,
  step: ProofMouseDragStep,
) {
  if (step.kind === 'pause') {
    await delay(step.ms ?? 16)
    return currentPoint
  }

  const point = await nextProofMousePoint(frame, transform, currentPoint, step)

  await context.page.mouse.move(point.x, point.y, { steps: step.steps ?? 8 })

  return point
}

async function nextProofMousePoint(
  frame: ProofMouseFrame,
  transform: ProofMouseFrameTransform,
  currentPoint: ProofMousePoint,
  step: Exclude<ProofMouseDragStep, { readonly kind: 'pause' }>,
) {
  if (step.kind === 'move-by') {
    return {
      x: currentPoint.x + step.dx * transform.scaleX,
      y: currentPoint.y + step.dy * transform.scaleY,
    }
  }

  return pointForSelector(
    frame,
    transform,
    step.selector,
    step.x,
    step.y,
    step.offsetX,
    step.offsetY,
  )
}

async function pointForSelector(
  frame: ProofMouseFrame,
  transform: ProofMouseFrameTransform,
  selector: string,
  xRatio = 0.5,
  yRatio = 0.5,
  offsetX = 0,
  offsetY = 0,
) {
  const box = await frame.locator(selector).boundingBox()
  if (!box) throw new Error(`Missing browser element for selector ${selector}`)

  return {
    x: box.x + box.width * xRatio + offsetX * transform.scaleX,
    y: box.y + box.height * yRatio + offsetY * transform.scaleY,
  }
}

async function proofMouseFrameTransform(frame: ProofMouseFrame): Promise<ProofMouseFrameTransform> {
  const rootBox = await frame.locator('html').boundingBox()
  const viewport = await frame.evaluate(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }))
  if (!rootBox) return identityProofMouseFrameTransform()
  if (viewport.width <= 0 || viewport.height <= 0) return identityProofMouseFrameTransform()

  return {
    originX: rootBox.x,
    originY: rootBox.y,
    scaleX: rootBox.width / viewport.width,
    scaleY: rootBox.height / viewport.height,
  }
}

function frameClientPointToPagePoint(
  transform: ProofMouseFrameTransform,
  point: ProofMousePoint,
): ProofMousePoint {
  return {
    x: transform.originX + point.x * transform.scaleX,
    y: transform.originY + point.y * transform.scaleY,
  }
}

function identityProofMouseFrameTransform(): ProofMouseFrameTransform {
  return {
    originX: 0,
    originY: 0,
    scaleX: 1,
    scaleY: 1,
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
