import { expect } from '@playwright/test'
import { fail } from './errors.mjs'

export async function runScenario(page, scenario, config, facts, measure) {
  if (scenario === 'open') return openScenario(page, facts.id === 'ordinary')
  await page.evaluate((multiple) => __stress.open(multiple, false), scenario === 'churn')
  await paintEvidence(page, await visibleRow(page, 0))
  await page.evaluate(() => __stress.verifyText())
  if (scenario === 'jump') return jumpScenario(page)
  if (scenario === 'typing') return measure(() => typingScenario(page, config.typedText))
  if (scenario === 'find-all') return findScenario(page, facts.searchCount)
  if (scenario === 'scroll') return scrollScenario(page, facts.id === 'long-line')
  return measure(() => churnScenario(page, config.churnCycles))
}

async function visibleRow(page, row) {
  const locator = page.locator(`#view-0 [data-editor-virtual-row="${row}"]`)
  await expect(locator).toBeVisible()
  await expect(locator).toBeInViewport()
  return locator
}

export async function paintEvidence(page, locator, highlighted = false, minimumInk = 20) {
  await expect(locator).toBeInViewport()
  const box = await locator.boundingBox()
  if (!box || box.width < 1 || box.height < 1) fail('No visible text geometry')
  const screenshot = await page.screenshot({
    clip: {
      x: Math.max(8, box.x),
      y: Math.max(8, box.y),
      width: Math.min(600, box.width),
      height: Math.min(20, box.height),
    },
    animations: 'disabled',
  })
  const completedAt = await page.evaluate(() => performance.now())
  const pixels = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let ink = 0
    let chromatic = 0
    for (let index = 0; index < data.length; index += 4) {
      const distance =
        Math.abs(data[index] - data[0]) +
        Math.abs(data[index + 1] - data[1]) +
        Math.abs(data[index + 2] - data[2])
      if (distance > 70) ink++
      if (
        Math.max(data[index], data[index + 1], data[index + 2]) -
          Math.min(data[index], data[index + 1], data[index + 2]) >
        40
      )
        chromatic++
    }
    return { ink, chromatic }
  }, screenshot.toString('base64'))
  if (pixels.ink < minimumInk || (highlighted && pixels.chromatic < 20))
    fail(`No ${highlighted ? 'highlighted ' : ''}text pixels: ${JSON.stringify(pixels)}`)
  return { completedAt, pixels }
}

async function openScenario(page, highlight) {
  const { start, attachedAt } = await page.evaluate(
    (highlight) => __stress.open(false, highlight),
    highlight,
  )
  const row = await visibleRow(page, 0)
  await expect(row).toContainText(/const|\/\//)
  const text = await paintEvidence(page, row)
  const latencyMs = {
    attach: [attachedAt - start],
    visibleTextUpperBound: [text.completedAt - start],
  }
  let highlighted = null
  if (highlight) {
    await page.waitForFunction(() => __stress.observe().state.initialHighlightStatus === 'painted')
    highlighted = await paintEvidence(page, row, true)
    latencyMs.highlightedPaintUpperBound = [highlighted.completedAt - start]
  }
  const observation = await page.evaluate(() => ({
    ...__stress.observe(),
    text: __stress.verifyText(),
  }))
  if (
    highlight &&
    !observation.paints.some(
      (paint) =>
        paint.phase === 'highlight-settled' &&
        paint.status === 'painted' &&
        paint.documentId === 'ordinary',
    )
  )
    fail('Missing authoritative highlight generation')
  return {
    latencyMs,
    observation: {
      ...observation,
      textPixels: text.pixels,
      highlightPixels: highlighted?.pixels ?? null,
    },
  }
}

async function jumpScenario(page) {
  const jump = await page.evaluate(() => __stress.jump(0.9))
  const row = await visibleRow(page, jump.row)
  await expect(row).toContainText(jump.text)
  const paint = await paintEvidence(page, row)
  const observation = await page.evaluate(() => __stress.observe())
  if (observation.state.cursor.row !== jump.row || observation.state.cursor.column !== jump.column)
    fail('Jump selected the wrong position')
  return {
    latencyMs: { commandToPaintUpperBound: [paint.completedAt - jump.at] },
    observation: { target: jump, cursor: observation.state.cursor, pixels: paint.pixels },
  }
}

async function typingScenario(page, typed) {
  const target = await page.evaluate(() => __stress.beginTyping())
  await page.keyboard.type(typed, { delay: 0 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const observation = await page.evaluate((typed) => __stress.finishTyping(typed), typed)
  const paint = await paintEvidence(page, await visibleRow(page, target.row))
  const first = observation.keys[0].at
  const last = observation.keys.at(-1).appliedAt
  return {
    latencyMs: {
      keyToApplied: observation.keys.map((key) => key.appliedAt - key.at),
      keyToFrame: observation.keys.map((key) => key.frameAt - key.at),
      burstToPaintUpperBound: [paint.completedAt - first],
    },
    throughput: {
      operations: typed.length,
      durationMs: last - first,
      operationsPerSecond: (typed.length * 1000) / (last - first),
    },
    observation: { ...observation, pixels: paint.pixels },
  }
}

async function findScenario(page, expectedCount) {
  await page.locator('#view-0 textarea').focus()
  await page.keyboard.press('Control+f')
  const input = page.getByRole('textbox', { name: 'Find', exact: true })
  await expect(input).toBeFocused()
  const at = await page.evaluate(() => performance.now())
  await page.keyboard.type('needle', { delay: 0 })
  const count = page.locator('.editor-find-count')
  await expect(count).toHaveText(new RegExp(`^\\d+ of ${expectedCount}$`))
  const completedAt = await page.evaluate(() => performance.now())
  const text = await count.textContent()
  return {
    latencyMs: { queryToCount: [completedAt - at] },
    observation: { query: 'needle', expectedCount, displayedCount: text, trustedInput: true },
  }
}

async function scrollScenario(page, horizontal) {
  const samples = []
  const observed = []
  await page.mouse.move(400, 180)
  for (const delta of [640, 1280, 2560, -1280, -640]) {
    const at = await page.evaluate(() => performance.now())
    const before = await page.evaluate(() => JSON.stringify(__stress.observe().scroll))
    await page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta)
    await page.waitForFunction(
      (before) => JSON.stringify(__stress.observe().scroll) !== before,
      before,
    )
    const rows = await page.evaluate(() => __stress.observe().rows)
    const rowIndex = await page.evaluate(visibleRowIndex)
    if (rowIndex === undefined) fail('Scroll rendered no row inside the viewport')
    const row = page.locator(`#view-0 [data-editor-virtual-row="${rowIndex}"]`)
    const paint = await paintEvidence(page, row)
    await page.evaluate(() => __stress.verifyRows())
    samples.push(paint.completedAt - at)
    observed.push({ row: rows[0].row, pixels: paint.pixels })
  }
  return {
    latencyMs: { wheelToPaintUpperBound: samples },
    observation: { sweeps: observed, trustedInput: true, horizontal },
  }
}

async function churnScenario(page, cycles) {
  const observation = await page.evaluate((cycles) => __stress.churn(cycles), cycles)
  await page.evaluate(() => __stress.probeViews())
  await expect(page.locator('#view-0 [data-editor-virtual-row="0"]')).toContainText(/^probe/)
  await expect(page.locator('#view-1 [data-editor-virtual-row="0"]')).toContainText(/^probe/)
  await page.evaluate(() => __stress.revealHidden())
  await expect(page.locator('#view-2 [data-editor-virtual-row="0"]')).toBeVisible()
  await expect(page.locator('#view-2 [data-editor-virtual-row="0"]')).toContainText(/^probe/)
  await page.evaluate(() => __stress.finishProbe())
  return {
    latencyMs: { editDelete: [observation.durationMs] },
    throughput: {
      operations: observation.operations,
      durationMs: observation.durationMs,
      operationsPerSecond: (observation.operations * 1000) / observation.durationMs,
    },
    observation,
  }
}

function visibleRowIndex() {
  const host = document.querySelector('#view-0').getBoundingClientRect()
  const row = [...document.querySelectorAll('#view-0 [data-editor-virtual-row]')].find((row) => {
    const box = row.getBoundingClientRect()
    return box.top >= host.top && box.bottom <= host.bottom
  })
  return row?.getAttribute('data-editor-virtual-row')
}
