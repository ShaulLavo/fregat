import type { Page } from 'playwright'

// Page scripts are strings: the scripts project compiles without the DOM lib.
const startSampling = `(selector) => {
  const counter = { blank: 0, running: true }
  window.__agentBlankFrames = counter
  const sample = () => {
    if (!counter.running) return
    if (!document.querySelector(selector)) counter.blank += 1
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
}`

const stopSampling = `(() => {
  const counter = window.__agentBlankFrames
  counter.running = false
  return counter.blank
})()`

/** Counts the animation frames during `drive` in which nothing matched `rowSelector`. */
export async function countBlankFrames(
  page: Page,
  rowSelector: string,
  drive: () => Promise<void>,
): Promise<number> {
  await page.evaluate(`(${startSampling})(${JSON.stringify(rowSelector)})`)
  await drive()

  return page.evaluate<number>(stopSampling)
}
