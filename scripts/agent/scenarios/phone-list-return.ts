import { equal, ok } from 'node:assert/strict'

import { recordFrames } from '../blank-frames'
import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { createSessions, openFixtureChat, PHONE_SESSIONS } from './phone-fixture'
import type { Scenario } from './index'

export const phoneListReturn: Scenario = {
  name: 'phone-list-return',
  description:
    'Tap different chats and return through browser Back, recording the list focus on every frame.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step, evidence }) {
    const fixture = await createModifiedFileFixture(
      'phone-list-return',
      'notes.md',
      ['one'],
      ['two'],
    )
    try {
      const base = await openFixtureChat(page, fixture)
      await createSessions(page, base, fixture)
      for (const [index, title] of PHONE_SESSIONS.entries()) {
        await selectors.sessionByTitle(page, title).tap()
        await selectors.phoneLevel(page, 'session').waitFor()
        await step(`chat-${index}`)
        const frames = await recordFrames<{ level: string | null; marked: unknown[] }>(
          page,
          `() => ({
          time: performance.now(),
          level: document.querySelector(${JSON.stringify(selectors.phoneLevelSelector)})?.getAttribute('data-phone-level') ?? null,
          focus: document.activeElement?.outerHTML.slice(0, 400),
          marked: Array.from(document.querySelectorAll(${JSON.stringify(selectors.sessionMarkedRowSelector)})).map(e => ({ title: e.getAttribute('title'), shadow: getComputedStyle(e).boxShadow })),
        })`,
          async () => {
            await page.goBack()
            await selectors.phoneLevel(page, 'sessions').waitFor()
            await page.waitForTimeout(2_500)
          },
        )
        await evidence.json(`return-${index}.json`, frames)
        await step(`returned-${index}`)
        equal(await selectors.sessionRail(page).count(), 1)
        const returned = frames.filter((frame) => frame.level === 'sessions')
        ok(returned.length > 0, 'The returned list must be observed')
        ok(
          returned.every((frame) => frame.marked.length === 0),
          'Opening a phone chat must leave no selection border on the returned list',
        )
      }
    } finally {
      await releaseFixture(fixture)
    }
  },
}
