import type { Page } from 'playwright'

import { recordFrames } from './blank-frames'

/** One animation frame: whether the target is on screen, coloured, and preview-decorated. */
export type PressFrame = {
  readonly t: number
  readonly text: boolean
  readonly colour: boolean
  readonly preview: boolean
}

export type PressTiming = {
  readonly name: string
  readonly textMs: number | null
  readonly colourMs: number | null
  readonly previewMs: number | null
  readonly frames: number
}

// Page scripts are strings: the scripts project compiles without the DOM lib.
/** Stamps the page's last press, so timings start at the input event, not at the driver. */
export const pressStampScript = `(() => {
  const note = (event) => { window.__agentPressAt = event.timeStamp }
  window.addEventListener('pointerdown', note, true)
  window.addEventListener('keydown', note, true)
})()`

const colourSeen = `(() => {
  const recorder = window.__agentFrameRecorder
  const pressAt = window.__agentPressAt ?? 0
  return recorder.frames.some((frame) => frame.t >= pressAt && frame.text && frame.colour)
})()`

const COLOUR_TIMEOUT_MS = 10_000
// Tokens can land in batches; a short tail catches a later preview decoration too.
const SETTLE_MS = 800

/**
 * Presses once and reports milliseconds from the input event until the target's first frame of
 * text, of syntax colour and of markdown preview. `sampler` is a page-side expression returning
 * a `PressFrame` for the current frame.
 */
export async function measurePress(
  page: Page,
  name: string,
  sampler: string,
  press: () => Promise<void>,
): Promise<PressTiming> {
  await page.evaluate('window.__agentPressAt = null')
  const frames = await recordFrames<PressFrame>(page, sampler, async () => {
    await press()
    await page.waitForFunction(colourSeen, null, { timeout: COLOUR_TIMEOUT_MS }).catch(() => {})
    await page.waitForTimeout(SETTLE_MS)
  })
  const pressAt = await page.evaluate<number | null>('window.__agentPressAt')
  const base = pressAt ?? frames[0]?.t ?? 0
  const after = frames.filter((frame) => frame.t >= base)
  const firstMs = (hit: (frame: PressFrame) => boolean) => {
    const frame = after.find(hit)
    return frame ? Math.round(frame.t - base) : null
  }
  return {
    name,
    textMs: firstMs((frame) => frame.text),
    colourMs: firstMs((frame) => frame.text && frame.colour),
    previewMs: firstMs((frame) => frame.text && frame.preview),
    frames: after.length,
  }
}
