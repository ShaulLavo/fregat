import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { createScriptError } from '../../structured-errors'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

// Three whole-file replacements delete enough text to make a maintenance pass due.
const LINES = 1400
const block = (round: number) =>
  Array.from({ length: LINES }, (_, line) => `block ${round} line ${line} `.padEnd(48, '.')).join(
    '\n',
  )

type PassDetail = { readonly tombstones: number; readonly unverified: number }

export const editorStorageMaintenance: Scenario = {
  name: 'editor-storage-maintenance',
  description:
    'Replace a file three times and type-and-backspace a word, wait for the quiet-time pass to compact tombstones and reclaim text, then undo and redo across it.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-storage-maintenance-')
    try {
      await writeFile(path.join(fixture, 'notes.txt'), `${block(0)}\n`)
      await openFixtureWorkspace(page, fixture)
      const url = new URL(page.url())
      url.searchParams.set('editorPerfTrace', '1')
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      await openFileFromTree(page, 'notes.txt')
      await focusEditor(page)
      for (let round = 1; round <= 3; round++) {
        await page.keyboard.press('Control+a')
        await page.keyboard.insertText(block(round))
        await page.waitForTimeout(50)
      }
      // Backspacing a unit at a time leaves a tombstone per unit.
      for (let cycle = 0; cycle < 40; cycle++) {
        await page.keyboard.type('word')
        for (let unit = 0; unit < 4; unit++) await page.keyboard.press('Backspace')
      }
      await step('edited')

      await resetTrace(page)
      const pass = await waitForPass(page)
      if (pass.tombstones <= 0 || pass.unverified !== 0)
        throw createScriptError(`Maintenance compacted nothing: ${JSON.stringify(pass)}`)
      await expectRow(page, 'block 3 line')
      await step('compacted')

      await pressUntil(page, 'Control+z', 'block 2 line')
      await step('undone-across-pass')
      await pressUntil(page, 'Control+y', 'block 3 line')
      await step('redone')
    } finally {
      await releaseFixture(fixture)
    }
  },
  inspect: async (page) => ({ pass: await lastPass(page) }),
}

type TraceHost = typeof window & {
  __editorPerfTrace?: {
    reset(): void
    report(): {
      traceEvents: { kind: string; diagnostic?: { name: string; detail?: PassDetail } }[]
    }
  }
}

function resetTrace(page: Page) {
  return page.evaluate(() => (window as TraceHost).__editorPerfTrace?.reset())
}

function lastPass(page: Page): Promise<PassDetail | null> {
  return page.evaluate(() => {
    const events = (window as TraceHost).__editorPerfTrace?.report().traceEvents ?? []
    const passes = events.filter((event) => event.diagnostic?.name === 'buffer.reclamation')
    return passes.at(-1)?.diagnostic?.detail ?? null
  })
}

async function waitForPass(page: Page): Promise<PassDetail> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pass = await lastPass(page)
    if (pass) return pass
    await page.waitForTimeout(100)
  }
  throw createScriptError('No maintenance pass was recorded within 15 seconds')
}

function expectRow(page: Page, text: string) {
  return selectors.editorRows(page).filter({ hasText: text }).first().waitFor({ timeout: 10_000 })
}

// Typing lands as many undo states, so the chord repeats until the rows read as expected.
async function pressUntil(page: Page, chord: string, text: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    await focusEditor(page)
    await page.keyboard.press(chord)
    if ((await selectors.editorRows(page).filter({ hasText: text }).count()) > 0) return
  }
  throw createScriptError(`${chord} never showed "${text}"`)
}
