import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { recordFrames } from '../blank-frames'
import { selectors } from '../selectors'
import { nativeLog, sendPrompt, withUserSetting } from './native-provider-verification'

/**
 * Sends `prompt` in token streaming mode and runs `sampler` — a page-side function over the
 * latest assistant answer element — every animation frame until the fixture's stream ends.
 * Frames where the sampler returns null (nothing to sample yet) are dropped.
 */
export async function streamedFrames<T>(
  page: Page,
  context: { readonly orchestration: string; readonly root: string },
  prompt: string,
  sampler: string,
): Promise<T[]> {
  const pageSampler = `() => {
    const answers = document.querySelectorAll(${JSON.stringify(selectors.chatMarkdownSelector)})
    const answer = answers[answers.length - 1]
    return answer ? (${sampler})(answer) : null
  }`
  let frames: (T | null)[] = []
  const setting = { key: 'chat.responseStreamingMode', value: 'token' }
  await withUserSetting(page, context.orchestration, setting, async () => {
    frames = await recordFrames<T | null>(page, pageSampler, async () => {
      await sendPrompt(page, prompt)
      await streamCompleted(context.root)
      await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
      await page.waitForTimeout(500)
    })
  })

  return frames.filter((frame): frame is T => frame !== null)
}

async function streamCompleted(root: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const entries = await nativeLog(root)
    if (entries.some((entry) => entry.event === 'stream-complete')) return
    await Bun.sleep(100)
  }
  ok(false, 'The fixture never finished streaming its answer')
}
