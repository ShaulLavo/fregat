import { describe, vi } from 'vitest'
import { page, server } from 'vitest/browser'

import { expect, test } from '../../../../test/fixtures'
import {
  checkChatExpectations,
  createMarkdownBrowser,
  readyForScreenshot,
} from '../../../../test/factories/markdown-browser'
import {
  MARKDOWN_CASES,
  VISUAL_STORY_IDS,
  WEBKIT_CRITICAL_IDS,
} from '../../../../../../packages/markdown/test/fixtures/cases'

const stories = MARKDOWN_CASES.filter((fixture) => VISUAL_STORY_IDS.includes(fixture.id))
const critical = MARKDOWN_CASES.filter((fixture) => WEBKIT_CRITICAL_IDS.includes(fixture.id))
const profiles = [
  { width: 390, theme: 'light' },
  { width: 390, theme: 'dark' },
  { width: 1440, theme: 'light' },
  { width: 1440, theme: 'dark' },
] as const

test('the visual matrix retains 32 stories and eight critical cross-browser stories', () => {
  expect(stories).toHaveLength(32)
  expect(critical).toHaveLength(8)
  expect(new Set(stories.map((fixture) => fixture.id)).size).toBe(32)
  expect(stories.every((fixture) => fixture.expected.length > 0)).toBe(true)
})

for (const profile of profiles) {
  describe(`${profile.width}px ${profile.theme} completed Markdown`, () => {
    test.each(stories)(
      '$id has independently expected content before baseline capture',
      async (fixture) => {
        const proof = await createMarkdownBrowser(profile)
        const receipt = await proof.update(fixture.source)
        await vi.waitFor(() => {
          expect(checkChatExpectations(proof.message(), fixture.expected)).toEqual([])
          expect(document.documentElement.classList.contains('dark')).toBe(profile.theme === 'dark')
        })
        await readyForScreenshot(proof.message())
        const bounds = proof.message().getBoundingClientRect()
        expect(bounds.width).toBeGreaterThan(0)
        expect(bounds.height).toBeGreaterThan(0)
        expect(bounds.width).toBeLessThanOrEqual(profile.width)
        expect(receipt.committed).toBeGreaterThanOrEqual(receipt.received)
        expect(receipt.painted).toBeGreaterThanOrEqual(receipt.committed)

        const screenshot = await page.screenshot({
          element: proof.host,
          path: `markdown-baseline/${server.browser}/${fixture.id}-${profile.width}-${profile.theme}.png`,
        })
        console.info(
          'MARKDOWN_BROWSER_VISUAL ' +
            JSON.stringify({
              fixture: fixture.id,
              engine: 'remark',
              browser: server.browser,
              width: profile.width,
              theme: profile.theme,
              screenshot,
              bounds: { width: bounds.width, height: bounds.height },
              outputMatches: true,
              candidate: 'unavailable',
            }),
        )

        if (fixture.id !== stories[0]?.id) return
        const repeated = await page.screenshot({
          element: proof.host,
          path: `markdown-baseline/${server.browser}/${fixture.id}-${profile.width}-${profile.theme}-self-repeat.png`,
        })
        console.info(
          'MARKDOWN_BROWSER_CALIBRATION ' +
            JSON.stringify({
              fixture: fixture.id,
              browser: server.browser,
              theme: profile.theme,
              width: profile.width,
              first: screenshot,
              repeated,
            }),
        )
      },
      30_000,
    )
  })
}

describe('critical WebKit-capable completed-message contracts', () => {
  test.each(critical)(
    '$id preserves the same required DOM on the selected browser engine',
    async (fixture) => {
      const proof = await createMarkdownBrowser({ width: 390 })
      await proof.update(fixture.source)
      await vi.waitFor(() =>
        expect(checkChatExpectations(proof.message(), fixture.expected)).toEqual([]),
      )
      await readyForScreenshot(proof.message())
      expect(proof.message().getBoundingClientRect().height).toBeGreaterThan(0)
    },
    30_000,
  )
})
