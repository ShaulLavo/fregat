import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { selectors } from '../selectors'

/** Chromium can supply CSS safe-area values; device toolbar and keyboard behavior still need a phone. */
export async function expectPhoneSafeAreas(page: Page, step: (label: string) => Promise<void>) {
  if (page.context().browser()?.browserType().name() !== 'chromium') return
  const cdp = await page.context().newCDPSession(page)
  const original = page.viewportSize()!
  const cases = [
    {
      label: 'safe-area-portrait',
      width: 390,
      height: 844,
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    },
    {
      label: 'safe-area-landscape',
      width: 844,
      height: 390,
      top: 0,
      right: 47,
      bottom: 21,
      left: 47,
    },
  ]
  try {
    for (const { label, width, height, ...insets } of cases) {
      await page.setViewportSize({ width, height })
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets })
      await selectors
        .phoneLevel(page, 'sessions')
        .evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
      const screen = await selectors.phoneLevel(page, 'sessions').boundingBox()
      ok(screen, 'The phone screen must be laid out')
      ok(Math.abs(screen.x - insets.left) <= 1, `Left safe area: ${JSON.stringify(screen)}`)
      ok(Math.abs(screen.y - insets.top) <= 1, `Top safe area: ${JSON.stringify(screen)}`)
      ok(
        Math.abs(screen.x + screen.width - (width - insets.right)) <= 1 &&
          Math.abs(screen.y + screen.height - (height - insets.bottom)) <= 1,
        `The screen respects the bottom and right safe areas: ${JSON.stringify(screen)}`,
      )
      await step(label)
    }
  } finally {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} })
    await cdp.detach()
    await page.setViewportSize(original)
  }
}
