import { ok } from 'node:assert/strict'
import { mermaidSelectors, selectors } from '../selectors'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

const FONT_DELAY_MS = 1500

type Mount = {
  readonly at: number
  readonly id: string
  readonly viewBox: string | null
  readonly nodes: string
  /** Whether every Inter face the labels need had loaded when this SVG appeared. */
  readonly faceLoaded: boolean
}

type Recorded = { readonly mounts: Mount[]; readonly fontEvents: string[] }

export const chatMermaidFirstPaint = isolatedNativeScenario({
  name: 'chat-mermaid-first-paint',
  description:
    'Reopen a chat whose diagram labels need an Inter subset that is still downloading; every diagram painted has the final size.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    await sendPrompt(page, 'Render the Mermaid font verification diagram.')
    await page.locator(mermaidSelectors.diagram).first().locator(mermaidSelectors.svg).waitFor({
      timeout: 30_000,
    })
    await selectors.chatStop(page).waitFor({ state: 'hidden' })
    // Cyrillic labels pull Inter's Cyrillic subset, which nothing else on screen sets. Dev's
    // StrictMode replays the diagram effect and discards a fallback measurement, so this passes on
    // a renderer without the font wait in dev; it catches that regression only where effects run once.
    await page.route('**/inter-cyrillic-wght-normal*.woff2', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS))
      await route.continue()
    })
    await page.addInitScript(recordDiagramPaints, mermaidSelectors.diagram)
    await page.reload()
    const host = page.locator(mermaidSelectors.diagram).first()
    await host.locator(mermaidSelectors.svg).waitFor({ timeout: 30_000 })
    await step('first-diagram-paint')
    await page.evaluate(() => document.fonts.ready)
    // Leave room for a font-load remeasure to land.
    await page.waitForTimeout(FONT_DELAY_MS + 1000)
    await step('settled')
    const recorded = await page.evaluate(
      () => (window as unknown as { __diagramPaints: Recorded }).__diagramPaints,
    )
    const sizes = new Set(recorded.mounts.map((mount) => `${mount.viewBox} ${mount.nodes}`))
    ok(recorded.mounts.length > 0, 'The diagram painted')
    ok(
      recorded.mounts[0]!.faceLoaded,
      `The first diagram paint had Inter's Cyrillic face: ${JSON.stringify(recorded)}`,
    )
    ok(sizes.size === 1, `Every diagram paint has the final size: ${JSON.stringify(recorded)}`)
    return recorded
  },
})

/** Runs in the page: logs each SVG a diagram host shows, and every font load. */
function recordDiagramPaints(diagram: string) {
  const recorded: Recorded = { mounts: [], fontEvents: [] }
  Object.assign(window, { __diagramPaints: recorded })
  const seen = new WeakSet<Element>()
  for (const type of ['loading', 'loadingdone', 'loadingerror']) {
    document.fonts.addEventListener(type, (event) => {
      const faces = (event as FontFaceSetLoadEvent).fontfaces.map((face) => face.family)
      recorded.fontEvents.push(`${Math.round(performance.now())} ${type} ${faces.join('|')}`)
    })
  }
  // A diagram mounts its SVG in a shadow root, which no mutation observer on the page sees.
  const tick = () => {
    for (const host of document.querySelectorAll(diagram)) {
      const svg = host.shadowRoot?.querySelector('svg')
      if (!svg || seen.has(svg)) continue
      seen.add(svg)
      recorded.mounts.push({
        at: Math.round(performance.now()),
        id: svg.id,
        viewBox: svg.getAttribute('viewBox'),
        // Node boxes carry the label measurement; the viewBox is rounded to whole pixels.
        nodes: Array.from(svg.querySelectorAll('.node rect'), (rect) =>
          rect.getAttribute('width'),
        ).join(' '),
        faceLoaded: document.fonts.check('1em "Inter Variable"', svg.textContent ?? ''),
      })
    }
    requestAnimationFrame(tick)
  }
  tick()
}
