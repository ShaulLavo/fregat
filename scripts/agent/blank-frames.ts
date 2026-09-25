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

const startRecording = `(sampler) => {
  const recorder = { frames: [], running: true }
  window.__agentFrameRecorder = recorder
  const sample = () => {
    if (!recorder.running) return
    recorder.frames.push(sampler())
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
}`

const stopRecording = `(() => {
  const recorder = window.__agentFrameRecorder
  recorder.running = false
  return recorder.frames
})()`

/**
 * Runs `sampler` (a page-side function expression, as a string) once per animation frame
 * during `drive` and returns every sample in order.
 */
export async function recordFrames<T>(
  page: Page,
  sampler: string,
  drive: () => Promise<void>,
): Promise<T[]> {
  await page.evaluate(`(${startRecording})(${sampler})`)
  await drive()

  return page.evaluate<T[]>(stopRecording)
}
