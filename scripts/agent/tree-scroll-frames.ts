import type { Page } from 'playwright'
import type { Evidence } from './evidence'
import { recordFrames } from './blank-frames'
import { treeScrollSelectors } from './selectors'

async function wheelBursts(page: Page) {
  for (const delta of [8, 8, 8, 8, 8, -8, -8, -8, -8, -8, 100, 100, 100, -100, -100, -100]) {
    await page.mouse.wheel(0, delta)
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(200)
}

/** Record painted frames and clip geometry while native scrolling outruns a throttled renderer. */
export async function captureTreeScroll(page: Page, evidence: Evidence) {
  const session = await page.context().newCDPSession(page)
  let frame = 0
  const writes: Promise<unknown>[] = []
  session.on('Page.screencastFrame', (event) => {
    writes.push(
      evidence.write(
        `frame-${String(frame++).padStart(4, '0')}.png`,
        Buffer.from(event.data, 'base64'),
      ),
    )
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  try {
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    const samples = await recordFrames(
      page,
      `() => {
      const selectors = ${JSON.stringify(treeScrollSelectors)}
      const scroll = document.querySelector(selectors.scroll)
      const flow = document.querySelector(selectors.flow)
      const overlay = document.querySelector(selectors.overlay)
      const viewport = document.querySelector(selectors.clip)
      if (!scroll || !flow || !overlay) return null
      const bounds = flow.getBoundingClientRect()
      const clip = viewport?.getBoundingClientRect()
      const overlayBottom = overlay.getBoundingClientRect().bottom
      const clipPath = getComputedStyle(flow).clipPath
      const legacyInset = Number.parseFloat(clipPath.slice(6)) || 0
      return {
        scroll: scroll.scrollTop,
        flow: bounds.toJSON(),
        viewport: clip?.toJSON(),
        overlayBottom,
        clipPath,
        seamError: (clip?.top ?? bounds.top + legacyInset) - overlayBottom,
        coverageError: clip && bounds.height >= clip.height
          ? Math.max(0, bounds.top - clip.top, clip.bottom - bounds.bottom) : 0,
        animations: flow.getAnimations().map(a => ({state:a.playState, timeline:a.timeline?.constructor.name})),
      }
    }`,
      () => wheelBursts(page),
    )
    await evidence.json('frames.json', samples)
  } finally {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await session.send('Page.stopScreencast')
    await Promise.all(writes)
    await session.detach()
  }
}
