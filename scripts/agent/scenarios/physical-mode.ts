import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

async function soundCount(page: Page) {
  return page.evaluate(() => Number(Reflect.get(window, 'physicalSoundCount') ?? 0))
}

export const physicalMode: Scenario = {
  name: 'physical-mode',
  description:
    'Persist Feel through Settings, then compare real primitives with pointer, keyboard, sound and reduced motion in the physical gallery.',
  async run(page, { step }) {
    const baseline = process.env.PHYSICAL_BASELINE === '1'
    const expectedFeel = baseline ? 'flat' : 'playful'
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('workbench.feel')
    for (const feel of ['seam', 'brisk', 'relaxed', 'playful', expectedFeel]) {
      await selectors.settingsFeel(page).click()
      await selectors.feelOption(page, feel).click()
      await page.waitForFunction((value) => document.documentElement.dataset.feel === value, feel)
    }
    await step('feel-setting')
    await page.waitForTimeout(500)
    await page.addInitScript(() => {
      Reflect.set(window, 'physicalSoundCount', 0)
      const original = AudioContext.prototype.createBufferSource
      AudioContext.prototype.createBufferSource = function () {
        Reflect.set(
          window,
          'physicalSoundCount',
          Number(Reflect.get(window, 'physicalSoundCount')) + 1,
        )
        return original.call(this)
      }
    })
    const url = new URL(page.url())
    url.pathname = '/dev/physical'
    url.search = ''
    url.hash = ''
    await page.goto(url.href)
    await selectors.physicalGallery(page).waitFor()
    strictEqual(await page.evaluate(() => document.documentElement.dataset.feel), expectedFeel)
    await selectors.physicalSwitch(page, 'Control sounds in this preview').click()

    for (const reduce of [false, true]) {
      await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' })
      const prefix = reduce ? 'reduced' : 'physical'
      const button = selectors.physicalButton(page, 'Press me')
      const before = await soundCount(page)
      await button.hover()
      await page.mouse.down()
      await page.waitForTimeout(180)
      const pressed = await button.evaluate((node) => ({
        scale: getComputedStyle(node).scale,
        opacity: getComputedStyle(node).opacity,
      }))
      if (reduce && !baseline) {
        strictEqual(pressed.scale, '1')
        ok(Number(pressed.opacity) < 1)
      } else if (!baseline) ok(Number(pressed.scale) < 1, `Button must sink: ${pressed.scale}`)
      await step(`${prefix}-pointer-press`)
      await page.mouse.up()
      strictEqual(await soundCount(page), before + 1)
      await button.focus()
      const keyboardBefore = await soundCount(page)
      await page.keyboard.down(' ')
      await page.waitForTimeout(180)
      strictEqual(await button.getAttribute('data-pressing'), '')
      await step(`${prefix}-keyboard-press`)
      await page.keyboard.up(' ')
      strictEqual(await button.getAttribute('data-pressing'), null)
      strictEqual(await soundCount(page), keyboardBefore)
      await selectors.physicalRow(page).click()
      strictEqual(await soundCount(page), keyboardBefore)

      const toggle = selectors.physicalSwitch(page, 'Preview switch')
      await toggle.hover()
      await page.mouse.down()
      await page.waitForTimeout(180)
      const scale = await selectors
        .physicalThumb(page)
        .evaluate((node) => getComputedStyle(node).scale)
      if (reduce && !baseline) strictEqual(scale, '1')
      else if (!baseline) ok(Number.parseFloat(scale) > 1, `Thumb must stretch: ${scale}`)
      await step(`${prefix}-switch-press`)
      await page.mouse.up()
      await selectors.physicalButton(page, 'Preview menu').click()
      await selectors.physicalMenu(page).waitFor()
      await step(`${prefix}-menu`)
      await page.keyboard.press('Escape')
      await selectors.physicalButton(page, 'Preview dialog').click()
      await selectors.physicalDialog(page).waitFor()
      await step(`${prefix}-dialog`)
      await page.keyboard.press('Escape')
      await selectors.physicalButton(page, 'Toggle invalid field').click()
      await step(`${prefix}-invalid-field`)
      await selectors.physicalButton(page, 'Toggle invalid field').click()
    }
    await selectors.physicalSwitch(page, 'Control sounds in this preview').click()
    const silent = await soundCount(page)
    await selectors.physicalButton(page, 'Press me').click()
    strictEqual(await soundCount(page), silent)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  },
}
