import type { Page } from 'playwright'

function instrumentFeedback() {
  Reflect.set(window, 'physicalSoundCount', 0)
  const original = AudioContext.prototype.createBufferSource
  AudioContext.prototype.createBufferSource = function () {
    Reflect.set(window, 'physicalSoundCount', Number(Reflect.get(window, 'physicalSoundCount')) + 1)
    return original.call(this)
  }
}

export async function installFeedbackProbe(page: Page) {
  await page.addInitScript(instrumentFeedback)
  await page.evaluate(instrumentFeedback)
}

export function feedbackSoundCount(page: Page) {
  return page.evaluate(() => Number(Reflect.get(window, 'physicalSoundCount') ?? 0))
}
