import { ok } from 'node:assert/strict'
import type { Locator } from 'playwright'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

async function box(locator: Locator) {
  const bounds = await locator.boundingBox()
  ok(bounds, 'Alignment target must be laid out')
  return bounds
}

export const chatAlignment = isolatedNativeScenario({
  name: 'chat-alignment',
  description:
    'Measure chat transcript, composer, session rows and adjacent headers in both densities and narrow stages.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    await selectors.chatMessage(page).fill('Verify buffered response and full reasoning retention.')
    await selectors.chatSend(page).click()
    await selectors.chatExactText(page, 'RESPONSE_DELIVERY_VERIFIED').waitFor({ timeout: 30_000 })
    const measurements = []
    const failures: string[] = []
    for (const width of [1920, 1440, 900]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const density of ['cozy', 'compact']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.density = value
        }, density)
        await page.waitForTimeout(250)
        const targets = selectors.chatAlignment(page)
        const assistant = await box(targets.assistant)
        const composer = await box(targets.composer)
        const attach = await box(targets.attachIcon)
        const work = await box(targets.workIcon)
        const title = await box(targets.rowTitle)
        const context = await box(targets.rowContext)
        const header = await box(targets.stageHeader)
        const toolHeader = await box(targets.toolHeader)
        const icons = await Promise.all((await targets.toolbarIcons.all()).map(box))
        const iconY = icons.map((icon) => icon.y + icon.height / 2)
        const offsets = {
          transcriptComposer: assistant.x - composer.x,
          activityColumn: work.x - assistant.x,
          sessionContext: context.x - title.x,
          headerTop: toolHeader.y - header.y,
          headerHeight: toolHeader.height - header.height,
          toolbarCentres: Math.max(...iconY) - Math.min(...iconY),
        }
        for (const [name, offset] of Object.entries(offsets))
          if (Math.abs(offset) > 0.5) failures.push(`${width}/${density} ${name}: ${offset}px`)
        measurements.push({
          width,
          density,
          assistantX: assistant.x,
          composerX: composer.x,
          attachX: attach.x,
          workX: work.x,
          titleX: title.x,
          contextX: context.x,
          headerY: header.y,
          headerHeight: header.height,
          offsets,
        })
        await step(`${width}-${density}`)
      }
    }
    console.log(JSON.stringify(measurements))
    ok(failures.length === 0, failures.join('\n'))
    return measurements
  },
})
