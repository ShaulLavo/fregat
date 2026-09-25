import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import { dispatch, readSessionDetail } from './chat-verification'
import {
  isolatedNativeScenario,
  nativeLog,
  sendPrompt,
  withUserSetting,
} from './native-provider-verification'

const STOP_PROMPT = 'STOP me after a partial answer.'

/** Plan 161 2.2–2.4: a stopped turn says why, and a new attempt never pulls a reader down. */
export const stoppedTurnReasons = isolatedNativeScenario({
  name: 'stopped-turn-reasons',
  description:
    'Stop a partial answer three ways — the Stop button, a runtime stop through the command API, a provider failure — and read each status line; Try again resends the same message while the reader, scrolled up, keeps their place.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, sessionId }) {
    const setting = { key: 'chat.responseStreamingMode', value: 'token' }
    // Each status line is checked and screenshotted; the drive goes on so one run shows all three.
    const missing: string[] = []
    const expectLine = async (line: RegExp) => {
      const problem = await statusLineProblem(page, orchestration, sessionId, line)
      if (problem) missing.push(problem)
    }
    await withUserSetting(page, orchestration, setting, async () => {
      const messages = selectors.chatMessages(page)
      await sendPrompt(page, 'FILL the transcript with a long answer.')
      await settled(page, root, 1)

      await sendPrompt(page, STOP_PROMPT)
      await messages.getByText(/^PARTIAL_ANSWER STOP/).waitFor({ timeout: 30_000 })
      await selectors.chatStop(page).click()
      await expectLine(/^You stopped it after \d/)
      await selectors
        .incompleteAnswer(page)
        .filter({ hasText: 'PARTIAL_ANSWER STOP' })
        .waitFor({ timeout: 30_000 })
      await step('user-stop-incomplete-answer')

      await selectors.turnTryAgain(page).click()
      await retriedWithSameMessage(page, root)
      const before = await scrollReaderUp(page)
      await step('reader-scrolled-up-before-the-retry-answers')
      await settled(page, root, 2)
      const after = await readViewport(page)
      ok(
        Math.abs(after.scrollTop - before.scrollTop) <= 2,
        `The reader keeps their place (scrollTop ${before.scrollTop} → ${after.scrollTop})`,
      )
      ok(after.distanceToEnd > after.clientHeight, 'The timeline did not jump to the new answer')
      await step('retry-answered-reader-kept-place')

      await scrollToEnd(page)
      await sendPrompt(page, 'FAIL after a partial answer.')
      await expectLine(/^Failed after \d/)
      await selectors.incompleteAnswer(page).filter({ hasText: 'PARTIAL_ANSWER FAIL' }).waitFor()
      await step('provider-failed')

      await sendPrompt(page, 'SESSION stop after a partial answer.')
      await messages.getByText(/^PARTIAL_ANSWER SESSION/).waitFor({ timeout: 30_000 })
      await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId })
      await expectLine(/^The session was stopped after \d/)
      await step('runtime-stopped')
      const stopped = await readSessionDetail(page, orchestration, sessionId)
      strictEqual(stopped.runtime?.lastError, null, 'A deliberate stop has no session error')
      strictEqual(stopped.latestTurn?.state, 'interrupted')
      const errors = stopped.activities.filter(
        (activity) => activity.turnId === stopped.latestTurn?.turnId && activity.tone === 'error',
      )
      strictEqual(errors.length, 0, 'A deliberate stop has no provider failure rows')
      strictEqual(await page.getByText('Codex session stopped.', { exact: true }).count(), 0)
    })
    ok(missing.length === 0, missing.join(' '))
  },
})

/** Waits for the fixture's `count`-th finished answer and for the turn to settle in the page. */
async function settled(page: Page, root: string, count: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const done = (await nativeLog(root)).filter((entry) => entry.event === 'stream-complete')
    if (done.length >= count) break
    await Bun.sleep(100)
  }
  await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
}

/** Waits for the stopped turn's line; when it never shows, names the projected turn instead. */
async function statusLineProblem(
  page: Page,
  orchestration: string,
  sessionId: string,
  line: RegExp,
) {
  try {
    await selectors.chatMessages(page).getByText(line).waitFor({ timeout: 15_000 })
    await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
    return null
  } catch {
    await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
    const { latestTurn, runtime } = await readSessionDetail(page, orchestration, sessionId)
    return `No status line ${line}: latest turn ${latestTurn?.state}/${latestTurn?.endReason ?? 'no reason'}, runtime ${runtime?.status} (${runtime?.lastError ?? 'no error'}).`
  }
}

async function retriedWithSameMessage(page: Page, root: string) {
  await selectors
    .chatMessages(page)
    .getByText(STOP_PROMPT, { exact: true })
    .nth(1)
    .waitFor({ timeout: 30_000 })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const starts = (await nativeLog(root)).filter(
      (entry) => entry.event === 'turn/start' && entry.input === STOP_PROMPT,
    )
    if (starts.length === 2) return
    await Bun.sleep(100)
  }
  ok(false, 'Try again must start a second turn with the same message')
}

async function readViewport(page: Page) {
  return selectors.chatMessages(page).evaluate((element) => ({
    clientHeight: element.clientHeight,
    distanceToEnd: element.scrollHeight - element.clientHeight - element.scrollTop,
    scrollTop: element.scrollTop,
  }))
}

/** Wheels the timeline up into the long first answer, as a reader does. */
async function scrollReaderUp(page: Page) {
  const box = await selectors.chatMessages(page).boundingBox()
  ok(box, 'The timeline is on screen')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -1_500)
  await page.waitForTimeout(400)
  const viewport = await readViewport(page)
  ok(viewport.distanceToEnd > viewport.clientHeight, 'The reader is in an older part')
  return viewport
}

async function scrollToEnd(page: Page) {
  await page.mouse.wheel(0, 100_000)
  await page.waitForTimeout(400)
}
