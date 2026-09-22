import { strictEqual } from 'node:assert'
import type { Page } from 'playwright'
import { openFileByName, paintedTokenColors, selectors } from '../selectors'
import type { Scenario } from './index'

type Frame = {
  readonly at: number
  readonly presentation: string | null
  readonly editor: boolean
  readonly rows: number
  readonly tokens: number
}

type Report = {
  readonly frames: readonly Frame[]
  readonly admissions: readonly unknown[]
  readonly fonts: readonly unknown[]
  readonly fontLoadedAt: number | null
}

// Page scripts are strings: the scripts project compiles without the DOM lib.
const sampleFrames = `(() => {
  const frames = []
  window.__agentReloadFrames = frames
  window.__agentFontLoadedAt = null
  const sample = () => {
    const scroll = document.querySelector('[data-editor-presentation]')
    let tokens = 0
    for (const [name, highlight] of CSS.highlights.entries()) {
      if (name.startsWith('editor-shared-token-')) tokens += highlight.size
    }
    if (window.__agentFontLoadedAt === null && [...document.fonts].some((face) => face.status === 'loaded'))
      window.__agentFontLoadedAt = Math.round(performance.now())
    frames.push({
      at: Math.round(performance.now()),
      presentation: scroll ? scroll.dataset.editorPresentation : null,
      editor: document.querySelector('.editor-virtualized-viewport') !== null,
      rows: document.querySelectorAll('.editor-virtualized-row').length,
      tokens: tokens + document.querySelectorAll('[data-editor-provisional-row] span[style*="color"]').length,
    })
    if (frames.length < 1200) requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
})()`

const readReport = `(() => ({
  frames: window.__agentReloadFrames,
  fontLoadedAt: window.__agentFontLoadedAt,
  admissions: performance.getEntriesByName('editor.snapshot.admission').map((entry) => ({
    at: Math.round(entry.startTime),
    ...entry.detail,
  })),
  fonts: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/fonts/')).map((entry) => ({
    start: Math.round(entry.startTime),
    end: Math.round(entry.responseEnd),
    transferSize: entry.transferSize,
    bodySize: entry.decodedBodySize,
  })),
}))()`

let lastReport: Report | null = null

export const editorReloadPaint: Scenario = {
  name: 'editor-reload-paint',
  description:
    'Open a file, reload the window, and check the first editor frame already shows highlighted text.',
  run: (page, context) => reloadAndSample(page, context, 0),
  inspect: async () => lastReport,
}

export const editorReloadPaintSlowFont: Scenario = {
  name: 'editor-reload-paint-slow-font',
  description:
    'The same reload with the editor font held back a second, as on a fast device or a slow link.',
  run: (page, context) => reloadAndSample(page, context, 1000),
  inspect: async () => lastReport,
}

async function reloadAndSample(
  page: Page,
  { file, step }: Parameters<Scenario['run']>[1],
  fontDelayMs: number,
) {
  await openFileByName(page, file)
  await waitForTokens(page)
  // A panel dragged to an odd width: default sizes hide a layout that settles after mount.
  const handle = await selectors.panelHandles(page).first().boundingBox()
  if (handle) {
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + 37.5, handle.y + handle.height / 2, { steps: 4 })
    await page.mouse.up()
  }
  // A scrolled viewport is the common case, and the one a top-of-file restore would hide.
  await selectors.editorSurface(page).first().hover()
  await page.mouse.wheel(0, 1800)
  // The capture is debounced; give it time to land in storage before leaving.
  await page.waitForTimeout(1200)
  await step('before-reload')

  if (fontDelayMs > 0) {
    await page.route('**/fonts/*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, fontDelayMs))
      await route.continue()
    })
  }
  await page.addInitScript(sampleFrames)
  await page.reload()
  await selectors.editorInput(page).first().waitFor({ timeout: 20_000 })
  await waitForTokens(page)
  await page.waitForTimeout(500)
  await step('after-reload')

  const report = await page.evaluate<Report>(readReport)
  lastReport = report
  // The presentation attribute only appears once a snapshot is admitted, so key on the viewport.
  const bare = report.frames.filter((frame) => frame.editor && frame.tokens === 0)
  strictEqual(bare.length, 0, `${bare.length} editor frames painted without highlighted text`)
}

async function waitForTokens(page: Page) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const colors = await paintedTokenColors(selectors.editorSurface(page).first())
    if (colors.length > 0) return
    await page.waitForTimeout(100)
  }
}
