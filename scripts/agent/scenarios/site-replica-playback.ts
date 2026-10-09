import type { Page } from 'playwright'
import { createScriptError } from '../../structured-errors'
import { siteReplicaSelectors as replica } from '../selectors'
import type { Scenario } from './index'

async function show(page: Page, id: string): Promise<void> {
  await replica.stage(page, id).evaluate((stage) => stage.scrollIntoView({ block: 'center' }))
  await replica.playing(page, id).waitFor()
}

async function textIs(page: Page, text: string): Promise<void> {
  if ((await replica.typed(page, 's-agents').textContent()) === text) return
  throw createScriptError('The replica typing callback changed the expected playback frame.')
}

async function noPress(page: Page): Promise<void> {
  if ((await replica.pressed(page, 's-review').count()) === 0) return
  throw createScriptError('An old replica pointer press survived skip or replay.')
}

export const siteReplicaPlayback: Scenario = {
  name: 'site-replica-playback',
  surface: 'site',
  readOnly: true,
  description:
    'Skip and replay the landing-page typing and pointer stories, then pause and resume.',
  async run(page, { step }) {
    await page.clock.install({ time: 0 })
    await page.clock.pauseAt(0)
    await page.reload()
    await show(page, 's-agents')
    await page.clock.runFor(900)
    await textIs(page, 'c')
    await step('agents-typing')
    await replica.replica(page, 's-agents').click()
    await textIs(page, 'claude auth login')
    await page.clock.runFor(30)
    await textIs(page, 'claude auth login')
    await step('agents-skip-holds-final')

    await replica.control(page, 's-agents').click()
    await page.clock.runFor(30)
    await textIs(page, 'claude auth login')
    await page.clock.runFor(870)
    await textIs(page, 'c')
    await step('agents-new-typing-run')
    await replica.control(page, 's-agents').click()
    await page.clock.runFor(900)
    await textIs(page, 'c')
    await step('agents-paused')
    await replica.control(page, 's-agents').click()
    await page.clock.runFor(30)
    await textIs(page, 'cl')
    await page.evaluate(() => scrollTo(0, 0))
    await replica.paused(page, 's-agents').waitFor()
    await page.clock.runFor(900)
    await textIs(page, 'cl')
    await show(page, 's-agents')
    await page.clock.runFor(30)
    await textIs(page, 'cla')
    await step('agents-offscreen-resumed')
    await replica.replica(page, 's-agents').click()

    await show(page, 's-review')
    await replica.replica(page, 's-review').click()
    await replica.control(page, 's-review').click()
    await page.clock.runFor(1200)
    await step('review-pointer-travelling')
    await replica.replica(page, 's-review').click()
    await replica.control(page, 's-review').click()
    await page.clock.runFor(720)
    await noPress(page)
    await step('review-clean-replay')
    await page.clock.runFor(1200)
    if ((await replica.pressed(page, 's-review').count()) !== 2)
      throw createScriptError('The new replica pointer press did not play.')
    await step('review-new-pointer-press')
    await replica.replica(page, 's-review').click()
    await noPress(page)
    await page.clock.runFor(900)
    await noPress(page)
    await step('review-skip-clears-press')
  },
}
