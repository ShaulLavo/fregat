import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { IsolatedServer } from '../isolated-server'
import { readLogs } from '../logs'
import { runPaletteCommand, selectors, waitForApp } from '../selectors'
import { createScriptError } from '../../structured-errors'
import type { Scenario } from './index'

const KEYSTROKES = 40
// Longer than the terminal's 100 ms quiet period, so each echo is its own burst.
const KEY_GAP_MS = 180

type Sample = Readonly<Record<string, number | null>>

export const terminalOutputTiming: Scenario = {
  name: 'terminal-output-timing',
  description:
    'Show the output timing readout, type into the shell with frame and low-latency drawing, and record key-press to drawn and shown times.',
  requiresIsolatedServer: true,
  async run(page, { evidence, server, step }) {
    if (!server) throw createScriptError('terminal-output-timing needs its throwaway server')
    // The first terminal can mount with the app, before any switch changes.
    let since = new Date()
    await waitForApp(page)
    await setSwitch(page, 'Show output timing', true)
    await page.keyboard.press('Escape')
    const results = []
    for (const lowLatency of [false, true]) {
      if (lowLatency) since = new Date()
      await setSwitch(page, 'Low-latency rendering', lowLatency)
      await page.keyboard.press('Escape')
      await runPaletteCommand(page, 'Show terminal')
      await selectors.terminalLiveCanvas(page).waitFor()
      const mount = await mountLine(page, server, since)
      const samples = await typeAndRead(page)
      const label = lowLatency ? 'immediate' : 'frame'
      await step(`terminal-output-timing-${label}`)
      results.push({ presentation: label, ...mount, samples, summary: summarize(samples) })
    }
    await evidence.json('output-timing.json', results)
  },
}

async function setSwitch(page: Page, title: string, on: boolean) {
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill(title)
  const toggle = selectors.settingsSwitch(page, title)
  await toggle.waitFor()
  if ((await toggle.getAttribute('aria-checked')) === String(on)) return
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/settings/write') && response.request().method() === 'POST',
  )
  await toggle.click()
  await saved
}

async function mountLine(page: Page, server: IsolatedServer, since: Date) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const events = await readLogs({
      action: 'terminal.mount',
      directory: server.logs,
      since,
      source: 'client',
    })
    const found = events.at(-1)
    if (found) return { backend: found.rendererBackend, desynchronized: found.desynchronized }
    await page.waitForTimeout(500)
  }
  throw createScriptError('The terminal never logged its mount')
}

async function typeAndRead(page: Page): Promise<Sample[]> {
  const surface = selectors.terminalSurface(page).first()
  const readout = selectors.terminalOutputTiming(page)
  await surface.click({ position: { x: 100, y: 60 } })
  const samples: Sample[] = []
  let previous = ''
  for (let index = 0; index < KEYSTROKES; index += 1) {
    await page.keyboard.press(index % 2 === 0 ? 'x' : 'Backspace')
    await page.waitForTimeout(KEY_GAP_MS)
    await readout.waitFor()
    const text = await readout.innerText()
    // Two identical readouts in a row can be a missed burst; skip rather than double count.
    if (text === previous) continue
    previous = text
    samples.push(await readSample(page))
  }
  ok(samples.length >= KEYSTROKES / 2, `Only ${samples.length} timing readouts changed`)
  return samples
}

async function readSample(page: Page): Promise<Sample> {
  const terms = selectors.terminalOutputTiming(page).locator('div')
  const sample: Record<string, number | null> = {}
  for (const term of await terms.all()) {
    const label = await term.locator('dt').innerText()
    const value = await term.locator('dd').innerText()
    const number = Number.parseFloat(value.replace('+', ''))
    sample[label] = Number.isFinite(number) ? number : null
  }
  return sample
}

function median(values: readonly number[]) {
  if (values.length === 0) return null
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function summarize(samples: readonly Sample[]) {
  const pick = (read: (sample: Sample) => number | null) =>
    median(samples.flatMap((sample) => read(sample) ?? []))
  const total = (sample: Sample, ...labels: string[]) => {
    let sum = 0
    for (const label of labels) {
      const value = sample[label]
      if (value === null || value === undefined) return null
      sum += value
    }
    return sum
  }
  return {
    samples: samples.length,
    keyToFirstOutputMs: pick((sample) => sample['First output'] ?? null),
    drawnAfterOutputMs: pick((sample) => sample.Drawn ?? null),
    shownAfterDrawnMs: pick((sample) => sample.Shown ?? null),
    keyToDrawnMs: pick((sample) => total(sample, 'First output', 'Output', 'Drawn')),
    keyToShownMs: pick((sample) => total(sample, 'First output', 'Output', 'Drawn', 'Shown')),
  }
}
