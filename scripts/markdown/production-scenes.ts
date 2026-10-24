import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import type {
  ProductionTimelineObservation,
  ProductionTimelineReceipt,
} from '../../apps/web/test/factories/markdown-production-types'
import { createScriptError } from '../structured-errors'
import { percentile } from './bench-types'
import { productionDigest } from './production-analysis'

const DRAFT = 'A typed draft'

export async function measureProductionTimeline(
  page: Page,
  count: number,
  source: string,
  output: string,
): Promise<ProductionTimelineReceipt> {
  const activityBefore = await page.evaluate(() => window.markdownProductionProbe.activity())
  const mounted = await page.evaluate(
    async ({ count, source }) => {
      const started = performance.now()
      const observation = await window.markdownProductionProbe.mountTimeline(count, source)
      return { observation, duration: performance.now() - started }
    },
    { count, source },
  )
  const composer = page.getByTestId('chat-input-editor')
  await composer.waitFor({ state: 'visible' })
  await composer.click()
  const inputs = observeTyping(page)
  await page.waitForFunction(() => document.querySelector('[data-measure-input="ready"]'))
  const typing = composer.pressSequentially(DRAFT, { delay: 25 })
  const streaming = page.evaluate(async (source) => {
    const started = performance.now()
    const revisions: ProductionTimelineObservation[] = []
    for (let index = 0; index < 8; index += 1) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, started + index * 40 - performance.now())),
      )
      revisions.push(
        await window.markdownProductionProbe.updateTimeline(`${source}\n\nGrowing ${index}.`, true),
      )
    }
    return { revisions, final: window.markdownProductionProbe.observeTimeline() }
  }, source)
  const [inputSamples, , streamed] = await Promise.all([inputs, typing, streaming])
  const typed = await page.evaluate(() => window.markdownProductionProbe.observeTimeline())
  const selected = await selectHistory(page)
  await page.evaluate(async (source) => {
    await window.markdownProductionProbe.updateTimeline(`${source}\n\nA newer tail.`, true)
  }, source)
  const preserved = await page.evaluate(() => window.markdownProductionProbe.observeTimeline())
  const scrolled = await parkAndUpdate(page, source)
  const activityAfter = await page.evaluate(() => window.markdownProductionProbe.activity())
  const receipt = {
    mounted: mounted.observation,
    streamed: streamed.final,
    streamRevisions: streamed.revisions,
    typed,
    selected: preserved,
    scrolled: scrolled.observation,
    timelineReadyPaintMs: mounted.duration,
    inputToPaintMs:
      inputSamples.length > 0
        ? percentile(
            inputSamples.map((sample) => sample.painted - sample.received),
            0.95,
          )
        : NaN,
    inputSamples,
    selectionToPaintMs: selected.duration,
    scrollToPaintMs: scrolled.duration,
    scrollDriftPx: scrolled.drift,
    followDistancePx: Math.max(
      0,
      streamed.final.scrollHeight - streamed.final.clientHeight - streamed.final.scrollTop,
    ),
    parkApplicable: scrolled.applicable,
    longTasks: activityAfter.longTasks?.slice(activityBefore.longTasks?.length ?? 0) ?? null,
    frameIntervalsMs: activityAfter.frameIntervalsMs.slice(activityBefore.frameIntervalsMs.length),
  }
  const failures = timelineFindings(receipt, count, selected.observation.selectedText, source)
  await writeFile(
    path.join(output, 'timeline-observations.json'),
    JSON.stringify({ ...receipt, findings: failures }, null, 2) + '\n',
  )
  if (failures.length > 0)
    throw createScriptError('Production timeline observations failed.', { internal: { failures } })
  return receipt
}

function observeTyping(page: Page) {
  return page.evaluate(async (expected) => {
    const editor = document.querySelector('[data-testid="chat-input-editor"]')
    if (!(editor instanceof HTMLElement)) throw new TypeError('Real ChatInput editor is missing')
    const samples: ProductionTimelineReceipt['inputSamples'][number][] = []
    const result = Promise.withResolvers<typeof samples>()
    let receivedCount = 0
    const finish = () => {
      editor.removeEventListener('keydown', observe, true)
      delete editor.dataset.measureInput
      clearTimeout(timer)
      result.resolve(samples)
    }
    const observe = (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
      receivedCount += 1
      const received = performance.now()
      const textBefore = editor.textContent ?? ''
      const key = event.key
      requestAnimationFrame(() =>
        setTimeout(() => {
          samples.push({
            received,
            painted: performance.now(),
            key,
            textBefore,
            paintedText: editor.textContent ?? '',
          })
          if (receivedCount === expected && samples.length === expected) finish()
        }, 0),
      )
    }
    const timer = setTimeout(finish, 10_000)
    editor.addEventListener('keydown', observe, true)
    editor.dataset.measureInput = 'ready'
    return result.promise
  }, DRAFT.length)
}

async function selectHistory(page: Page) {
  const paragraph = page
    .getByRole('log')
    .locator('[data-chat-markdown]')
    .last()
    .locator('p')
    .first()
  const started = performance.now()
  await paragraph.click({ clickCount: 3 })
  const observation = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    return window.markdownProductionProbe.observeTimeline()
  })
  return { observation, duration: performance.now() - started }
}

async function parkAndUpdate(
  page: Page,
  source: string,
): Promise<{
  observation: ProductionTimelineObservation
  duration: number
  drift: number
  applicable: boolean
}> {
  await page.getByRole('log').hover()
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(150)
  const before = await page.evaluate(() => window.markdownProductionProbe.observeTimeline())
  const update = await page.evaluate(async (source) => {
    const started = performance.now()
    const observation = await window.markdownProductionProbe.updateTimeline(
      `${source}\n\nParked reader update.`,
      true,
    )
    return { observation, duration: performance.now() - started }
  }, source)
  return {
    ...update,
    drift: update.observation.scrollTop - before.scrollTop,
    applicable: before.scrollHeight > before.clientHeight + 1,
  }
}

function timelineFindings(
  receipt: ProductionTimelineReceipt,
  count: number,
  selected: string,
  source: string,
) {
  const failures: string[] = []
  if (
    receipt.mounted.logicalMessages !== count ||
    receipt.mounted.renderedMessages === 0 ||
    receipt.mounted.renderedMessages > count
  )
    failures.push('Timeline did not render the declared real messages.')
  if (count >= 100 && receipt.mounted.renderedMessages >= count)
    failures.push('Large history was not virtualized.')
  if (
    receipt.streamRevisions.length !== 8 ||
    new Set(receipt.streamRevisions.map((frame) => frame.revision)).size !== 8 ||
    new Set(receipt.streamRevisions.map((frame) => frame.sourceSha256)).size !== 8 ||
    receipt.streamRevisions.some(
      (frame, index) =>
        frame.sourceSha256 !== productionDigest(`${source}\n\nGrowing ${index}.`) ||
        frame.parserCalls === 0 ||
        !frame.renderedTailText.includes(`Growing ${index}.`),
    )
  )
    failures.push('Timeline streaming did not publish every distinct source revision.')
  if (receipt.typed.composerText !== DRAFT || receipt.inputSamples.length !== DRAFT.length)
    failures.push('Real ChatInput did not receive every typed character.')
  if (
    receipt.inputSamples.some(
      (sample, index) =>
        sample.key !== DRAFT[index] ||
        sample.textBefore !== DRAFT.slice(0, index) ||
        !sample.paintedText.startsWith(DRAFT.slice(0, index + 1)) ||
        sample.painted < sample.received,
    )
  )
    failures.push('Native input-to-frame receipts are incomplete or reordered.')
  if (!selected || receipt.selected.selectedText !== selected)
    failures.push('Native selection was empty or changed during streaming.')
  if (receipt.followDistancePx > 2)
    failures.push('The following reader did not remain at the tail.')
  if (receipt.parkApplicable && (receipt.scrolled.pinned || Math.abs(receipt.scrollDriftPx) > 2))
    failures.push('The parked reader moved or resumed following during streaming.')
  return failures
}
