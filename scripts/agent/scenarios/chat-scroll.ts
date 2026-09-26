import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { chatMessagesLogSelector, selectors } from '../selectors'
import { sendPrompt, withUserSetting } from './native-provider-verification'
import { isolatedNativeScenario } from './native-provider-verification'
import { streamCompleted } from './stream-frames'

/**
 * Chat scroll behaviours (Plan 181): the growing end stays visible while pinned, a reader who
 * scrolled up is not moved, the jump button returns to the live edge and keeps following, and
 * "Load earlier" keeps the row under the reader where it was.
 */

type ScrollFrame = {
  /** How far the latest answer's bottom sits below the viewport bottom; positive is hidden. */
  readonly endHidden: number | null
  /** Viewport-relative top of the row the scenario pinned with `markReference`, when rendered. */
  readonly referenceTop: number | null
  readonly scrollTop: number
  readonly textLength: number
  readonly time: number
}

// Page scripts are strings: the scripts project compiles without the DOM lib.
const startScrollRecorder = `(logSelector) => {
  const recorder = { frames: [], running: true, reference: null }
  window.__chatScrollRecorder = recorder
  const sample = () => {
    if (!recorder.running) return
    const log = document.querySelector(logSelector)
    if (log) {
      const box = log.getBoundingClientRect()
      const answers = log.querySelectorAll('[data-chat-markdown]')
      const answer = answers[answers.length - 1]
      const row = recorder.reference
        ? log.querySelector('[data-timeline-row-id="' + recorder.reference + '"]')
        : null
      recorder.frames.push({
        endHidden: answer ? answer.getBoundingClientRect().bottom - box.bottom : null,
        referenceTop: row ? row.getBoundingClientRect().top - box.top : null,
        scrollTop: log.scrollTop,
        textLength: answer ? (answer.textContent || '').length : 0,
        time: performance.now(),
      })
    }
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
}`

const stopScrollRecorder = `(() => {
  const recorder = window.__chatScrollRecorder
  recorder.running = false
  return recorder.frames
})()`

async function startRecording(page: Page) {
  await page.evaluate(`(${startScrollRecorder})(${JSON.stringify(chatMessagesLogSelector)})`)
}

async function stopRecording(page: Page) {
  return page.evaluate<ScrollFrame[]>(stopScrollRecorder)
}

/** Picks the row under the viewport's `fraction` height and follows its top from now on. */
async function markReference(page: Page, fraction: number) {
  return page.evaluate(
    `((selector, fraction) => {
      const log = document.querySelector(selector)
      const box = log.getBoundingClientRect()
      const y = box.top + box.height * fraction
      const rows = [...log.querySelectorAll('[data-timeline-row-id]')]
      const row = rows.find((element) => {
        const rect = element.getBoundingClientRect()
        return rect.top <= y && rect.bottom >= y
      })
      const id = row ? row.getAttribute('data-timeline-row-id') : null
      window.__chatScrollRecorder.reference = id
      return id
    })(${JSON.stringify(chatMessagesLogSelector)}, ${fraction})`,
  )
}

async function seedHistory(page: Page) {
  await sendPrompt(page, 'HISTORY for the scroll scenarios.')
  await selectors
    .chatMessages(page)
    .getByText('SCROLL_HISTORY_23 paragraph 1', { exact: false })
    .waitFor({
      timeout: 30_000,
    })
  await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
}

/** Resolves once the streaming answer is taller than the part of the viewport below its prompt. */
async function answerOverflows(page: Page) {
  await page.waitForFunction(
    `(() => {
      const log = document.querySelector(${JSON.stringify(chatMessagesLogSelector)})
      const answers = log ? log.querySelectorAll('[data-chat-markdown]') : []
      const answer = answers[answers.length - 1]
      return !!answer && (answer.textContent || '').includes('SCROLL_STREAM') &&
        answer.getBoundingClientRect().height > log.clientHeight * 0.9
    })()`,
    undefined,
    { timeout: 30_000 },
  )
}

async function wheelOverLog(page: Page, deltaY: number) {
  const box = await selectors.chatMessages(page).boundingBox()
  ok(box, 'The transcript must be laid out')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, deltaY)
}

/** Every frame as `referenceTop@scrollTop/endHidden`, for a failure's log. */
function series(frames: readonly ScrollFrame[]) {
  return frames
    .map((frame) => `${frame.referenceTop}@${frame.scrollTop}/${frame.endHidden?.toFixed(0)}`)
    .join(' ')
}

function describe(frames: readonly ScrollFrame[], pick: (frame: ScrollFrame) => number | null) {
  const values = frames.map(pick).filter((value): value is number => value !== null)
  if (values.length === 0) return 'no samples'
  return `min ${Math.min(...values).toFixed(1)}, max ${Math.max(...values).toFixed(1)} over ${values.length} frames`
}

const TOKEN_STREAMING = { key: 'chat.responseStreamingMode', value: 'token' }
const fixture = new URL('../fixtures/native-codex.mjs', import.meta.url)

export const chatScrollPinned = isolatedNativeScenario({
  name: 'chat-scroll-pinned',
  description:
    'Stream a long answer below a scrolled transcript: once it outgrows the viewport, its growing end stays visible in every frame.',
  fixture,
  async drive(page, { step, orchestration, root }) {
    await seedHistory(page)
    await step('history')
    await withUserSetting(page, orchestration, TOKEN_STREAMING, async () => {
      await startRecording(page)
      await sendPrompt(page, 'STREAM a long answer.')
      await answerOverflows(page)
      await step('answer-overflows')
      await streamCompleted(root)
      await page.waitForTimeout(500)
      const frames = await stopRecording(page)
      await step('stream-done')
      const overflowing = frames.filter((frame) => frame.textLength > 0)
      const firstHidden = overflowing.findIndex((frame) => (frame.endHidden ?? 0) > 2)
      const lateFrames = overflowing.slice(Math.max(0, firstHidden))
      const hidden = lateFrames.filter((frame) => (frame.endHidden ?? 0) > 2)
      console.log(
        `chat-scroll-pinned: end hidden ${describe(overflowing, (frame) => frame.endHidden)}`,
      )
      console.log(
        `chat-scroll-pinned: ${hidden.length} of ${overflowing.length} frames hid the growing end`,
      )
      ok(
        hidden.length === 0,
        `${hidden.length} of ${overflowing.length} frames hid the growing end; worst ${Math.max(...hidden.map((frame) => frame.endHidden ?? 0)).toFixed(1)} px`,
      )
    })
  },
})

async function readerHeld(
  page: Page,
  context: { step: (name: string) => Promise<void>; orchestration: string; root: string },
  wheel: number,
  label: string,
) {
  await seedHistory(page)
  await withUserSetting(page, context.orchestration, TOKEN_STREAMING, async () => {
    await sendPrompt(page, 'STREAM a long answer.')
    await answerOverflows(page)
    await startRecording(page)
    await wheelOverLog(page, wheel)
    await page.waitForTimeout(300)
    const reference = await markReference(page, 0.5)
    ok(reference, 'A row sits under the middle of the viewport')
    await context.step(`${label}-scrolled-up`)
    await page.waitForTimeout(2_000)
    await context.step(`${label}-while-streaming`)
    await streamCompleted(context.root)
    await page.waitForTimeout(500)
    const frames = await stopRecording(page)
    await context.step(`${label}-stream-done`)
    // The settled turn trades its Working row above the answer for a status row below it, which
    // moves an answer being read by one row (an owner question in Plan 181); streaming may not.
    const finalLength = Math.max(...frames.map((frame) => frame.textLength))
    const streaming = frames.filter((frame) => frame.textLength < finalLength)
    const tracked = streaming.filter((frame) => frame.referenceTop !== null)
    const first = tracked[0]?.referenceTop ?? 0
    const moved = tracked.filter((frame) => Math.abs((frame.referenceTop ?? 0) - first) > 1)
    const settled = frames.at(-1)?.referenceTop
    console.log(
      `chat-scroll ${label}: reference ${reference} top ${describe(tracked, (frame) => frame.referenceTop)} while streaming, ${settled} settled`,
    )
    if (moved.length > 0) console.log(`chat-scroll ${label}: ${series(frames)}`)
    ok(tracked.length > 10, `The reference row stayed rendered (${tracked.length} frames)`)
    ok(
      moved.length === 0,
      `${moved.length} of ${tracked.length} streaming frames moved the row under the reader (${describe(tracked, (frame) => frame.referenceTop)})`,
    )
    const jump = selectors.timelineJumpToLatest(page)
    ok(
      (await jump.getAttribute('tabindex')) === '0',
      'The jump button is offered while the reader is away from the end',
    )
  })
}

export const chatScrollReaderHeld = isolatedNativeScenario({
  name: 'chat-scroll-reader-held',
  description:
    'Scroll up into history while an answer streams: the row under the reader does not move and the jump button is offered.',
  fixture,
  async drive(page, context) {
    await readerHeld(page, context, -900, 'history')
  },
})

export const chatScrollFoldHeld = isolatedNativeScenario({
  name: 'chat-scroll-fold-held',
  description:
    'Scroll up a little while an answer streams, so the growing answer spans the fold: it grows downward without dragging the view.',
  fixture,
  async drive(page, context) {
    await readerHeld(page, context, -160, 'fold')
  },
})

export const chatScrollJump = isolatedNativeScenario({
  name: 'chat-scroll-jump',
  description:
    'Scroll up while an answer streams, press the jump button: the view returns to the end and follows the rest of the stream.',
  fixture,
  async drive(page, { step, orchestration, root }) {
    await seedHistory(page)
    await withUserSetting(page, orchestration, TOKEN_STREAMING, async () => {
      await sendPrompt(page, 'STREAM a long answer.')
      await answerOverflows(page)
      await wheelOverLog(page, -900)
      await page.waitForTimeout(400)
      const jump = selectors.timelineJumpToLatest(page)
      ok((await jump.getAttribute('tabindex')) === '0', 'The jump button is offered')
      await step('jump-offered')
      await jump.click()
      await page.waitForTimeout(300)
      await startRecording(page)
      await step('jumped')
      await streamCompleted(root)
      await page.waitForTimeout(500)
      const frames = await stopRecording(page)
      await step('stream-done')
      const hidden = frames.filter((frame) => (frame.endHidden ?? 0) > 2)
      console.log(`chat-scroll-jump: end hidden ${describe(frames, (frame) => frame.endHidden)}`)
      ok(
        hidden.length === 0,
        `${hidden.length} of ${frames.length} frames after the jump hid the growing end (${describe(frames, (frame) => frame.endHidden)})`,
      )
      ok((await jump.getAttribute('tabindex')) === '-1', 'The jump button hides at the end')
    })
  },
})

/** Twenty turns of eleven messages: more than one detail window (200 messages) holds. */
async function buildLongSession(page: Page) {
  const messages = selectors.chatMessages(page)
  for (let turn = 0; turn < 20; turn += 1) {
    await sendPrompt(page, `PAGE ${turn}`)
    await messages.getByText(`PAGE ${turn}`, { exact: true }).waitFor({ timeout: 30_000 })
    await messages
      .getByText(`PAGE_ANSWER_${turn} paragraph 1`, { exact: false })
      .waitFor({ timeout: 30_000 })
    await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
  }
}

/** Where the transcript sits and which rows it renders, for a failure's log. */
async function describeTimeline(page: Page) {
  return page.evaluate(`(() => {
    const log = document.querySelector(${JSON.stringify(chatMessagesLogSelector)})
    if (!log) return 'no transcript on screen'
    const saved = Object.keys(sessionStorage).filter((key) => key.endsWith('chat.timeline-view.v1'))
      .map((key) => sessionStorage.getItem(key).slice(0, 300))
    const rows = [...log.querySelectorAll('[data-timeline-row-id]')].map((row) => (row.textContent || '').slice(0, 16))
    return JSON.stringify({ scrollTop: log.scrollTop, scrollHeight: log.scrollHeight, clientHeight: log.clientHeight, rows: [rows[0], rows.at(-1)], saved })
  })()`)
}

/** Reloads a long session and waits for the latest answer, which a reload reopens on. */
async function reloadAtLatest(page: Page) {
  const messages = selectors.chatMessages(page)
  const before = await describeTimeline(page)
  await page.reload()
  await messages.waitFor()
  const latest = messages.getByText('PAGE_ANSWER_19 paragraph 4', { exact: false })
  try {
    await latest.waitFor({ timeout: 10_000 })
  } catch (error) {
    console.log(`chat-scroll reload: before ${before}`)
    console.log(`chat-scroll reload: after ${await describeTimeline(page)}`)
    throw error
  }
}

async function openHistoryWindow(page: Page) {
  await buildLongSession(page)
  await reloadAtLatest(page)
  const messages = selectors.chatMessages(page)
  await messages.focus()
  await page.keyboard.press('Control+Home')
  const earlier = page.getByRole('button', { name: 'Load earlier', exact: true })
  await earlier.waitFor()
  return earlier
}

export const chatScrollHome = isolatedNativeScenario({
  name: 'chat-scroll-home',
  description:
    'Press Ctrl+Home in a reloaded long session, whose older rows are still estimates: the view reaches the first row.',
  fixture,
  async drive(page, { step }) {
    await buildLongSession(page)
    await reloadAtLatest(page)
    const messages = selectors.chatMessages(page)
    await messages.focus()
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(1_500)
    await step('after-home')
    const top = await messages.evaluate((log) => ({
      scrollTop: log.scrollTop,
      first: log.querySelector('[data-index]')?.getAttribute('data-index'),
    }))
    ok(top.scrollTop === 0 && top.first === '0', `Ctrl+Home stopped at ${JSON.stringify(top)}`)
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(1_500)
    await step('after-end')
    await messages.getByText('PAGE_ANSWER_19 paragraph 4', { exact: false }).waitFor()
    const distance = await messages.evaluate(
      (log) => log.scrollHeight - log.scrollTop - log.clientHeight,
    )
    ok(distance <= 2, `Ctrl+End stopped ${distance} px above the end`)
  },
})

export const chatScrollReload = isolatedNativeScenario({
  name: 'chat-scroll-reload',
  description:
    'Reload a long session that sits at its latest answer: it reopens on that answer, and again after a second reload.',
  fixture,
  async drive(page, { step }) {
    await buildLongSession(page)
    await step('before-reload')
    await reloadAtLatest(page)
    await step('reloaded')
    await reloadAtLatest(page)
    await step('reloaded-again')
  },
})

export const chatScrollLoadEarlier = isolatedNativeScenario({
  name: 'chat-scroll-load-earlier',
  description:
    'Press "Load earlier" at the top of a reloaded transcript: the row that was first stays where it was on screen.',
  fixture,
  async drive(page, { step }) {
    const earlier = await openHistoryWindow(page)
    await page.waitForTimeout(300)
    await startRecording(page)
    const reference = await markReference(page, 0.4)
    ok(reference, 'A row sits in the viewport')
    await step('before-page')
    await earlier.click()
    await page
      .getByRole('button', { name: /Loading earlier|Load earlier/ })
      .waitFor({ state: 'hidden', timeout: 30_000 })
    await page.waitForTimeout(800)
    const recorded = await stopRecording(page)
    await step('after-page')
    // Frames sampled before the reference was picked carry none.
    const frames = recorded.slice(recorded.findIndex((frame) => frame.referenceTop !== null))
    const tracked = frames.filter((frame) => frame.referenceTop !== null)
    const first = tracked[0]?.referenceTop ?? 0
    const last = tracked.at(-1)?.referenceTop ?? 0
    const moved = tracked.filter((frame) => Math.abs((frame.referenceTop ?? 0) - first) > 2)
    console.log(
      `chat-scroll-load-earlier: reference ${reference} top ${describe(tracked, (frame) => frame.referenceTop)}; ${tracked.length} of ${frames.length} frames rendered it`,
    )
    ok(
      tracked.length === frames.length,
      `The reference row left the viewport in ${frames.length - tracked.length} frames`,
    )
    ok(Math.abs(last - first) <= 2, `The row under the reader moved from ${first} to ${last}`)
    ok(
      moved.length === 0,
      `${moved.length} of ${tracked.length} frames showed the row away from its place`,
    )
  },
})

export const chatScrollLoadEarlierJump = isolatedNativeScenario({
  name: 'chat-scroll-load-earlier-jump',
  description:
    'Press "Load earlier", then the jump button before the page lands: the view ends at the latest message (TanStack #1267).',
  fixture,
  async drive(page, { step }) {
    const earlier = await openHistoryWindow(page)
    const jump = selectors.timelineJumpToLatest(page)
    ok((await jump.getAttribute('tabindex')) === '0', 'The jump button is offered at the top')
    await earlier.click()
    await jump.click()
    await page
      .getByRole('button', { name: /Loading earlier|Load earlier/ })
      .waitFor({ state: 'hidden', timeout: 30_000 })
    await page.waitForTimeout(800)
    await step('after-page-and-jump')
    const latest = selectors
      .chatMessages(page)
      .getByText('PAGE_ANSWER_19 paragraph 4', { exact: false })
    ok(await latest.isVisible(), 'The latest message is on screen')
    const distance = await selectors
      .chatMessages(page)
      .evaluate((log) => log.scrollHeight - log.scrollTop - log.clientHeight)
    ok(distance <= 24, `The view stopped ${distance} px above the end`)
  },
})

/** Clicks the first closed disclosure in `row` and checks the row's top held within a pixel. */
async function openHeldStill(page: Page, rowId: string, label: string) {
  const row = selectors.timelineRow(page, rowId)
  const disclosure = row.locator('[data-scroll-anchor-ignore][aria-expanded="false"]').first()
  const before = (await row.boundingBox())?.y
  await disclosure.click()
  await page.waitForTimeout(400)
  const after = (await row.boundingBox())?.y
  ok(before !== undefined && after !== undefined, `The ${label} row stays laid out`)
  ok(
    Math.abs(after - before) <= 1,
    `The ${label} row moved from ${before} to ${after} as it opened`,
  )
}

async function disclosureRow(page: Page, position: 'first' | 'last') {
  const disclosures = selectors.chatDisclosures(page)
  const disclosure = position === 'first' ? disclosures.first() : disclosures.last()
  await disclosure.waitFor()
  const rowId = await disclosure.evaluate((element) =>
    element.closest('[data-timeline-row-id]')?.getAttribute('data-timeline-row-id'),
  )
  ok(rowId, 'The disclosure sits in a timeline row')
  return rowId
}

export const chatScrollDisclosure = isolatedNativeScenario({
  name: 'chat-scroll-disclosure',
  description:
    'Open a disclosure at the live edge and one deep in history: each row stays under the pointer, and following stops at the edge.',
  fixture,
  async drive(page, { step }) {
    const long = Array.from({ length: 30 }, (_, line) => `Line ${line + 1} of a long prompt.`)
    await sendPrompt(page, `HISTORY behind a long prompt.\n${long.join('\n')}`)
    const messages = selectors.chatMessages(page)
    await messages.getByText('SCROLL_HISTORY_23 paragraph 1', { exact: false }).waitFor({
      timeout: 30_000,
    })
    await sendPrompt(page, 'PAGE 0')
    await messages.getByText('PAGE_ANSWER_0 paragraph 4', { exact: false }).waitFor({
      timeout: 30_000,
    })
    await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
    await page.waitForTimeout(300)
    await step('at-the-edge')
    await openHeldStill(page, await disclosureRow(page, 'last'), 'live-edge')
    await step('opened-at-the-edge')
    const jump = selectors.timelineJumpToLatest(page)
    ok((await jump.getAttribute('tabindex')) === '0', 'Opening output stops following')

    await messages.focus()
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(400)
    await openHeldStill(page, await disclosureRow(page, 'first'), 'history')
    await step('opened-in-history')
  },
})
