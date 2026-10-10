import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { morphSelectors, selectors } from '../selectors'

type Landing = {
  readonly pieces: number
  readonly checked: number
  readonly mismatched: readonly string[]
  readonly maxDriftPx: number
}

/**
 * Page-side: every running morph animation parked just before its end, then each overlay piece
 * checked against the real (hidden) row text under it. The text there must read the same and
 * start within half a pixel, or the handoff to the real rows would jump.
 */
function parkAndCompare(pieceSelector: string): Landing {
  for (const animation of document.getAnimations()) {
    const end = animation.effect?.getComputedTiming().endTime
    if (typeof end !== 'number' || !Number.isFinite(end)) continue
    animation.pause()
    animation.currentTime = end - 0.01
  }
  const pieces = Array.from(document.querySelectorAll<HTMLElement>(pieceSelector))
  const mismatched: string[] = []
  let maxDriftPx = 0
  let checked = 0
  for (const piece of pieces) {
    if (Number(getComputedStyle(piece).opacity) < 0.99) continue
    const rect = piece.getBoundingClientRect()
    const hit = document.caretPositionFromPoint(rect.left + 1, rect.top + rect.height / 2)
    const node = hit?.offsetNode
    if (!node || node.nodeType !== Node.TEXT_NODE) continue
    const text = node.textContent ?? ''
    const expected = piece.textContent ?? ''
    // The hit may land inside the first glyph; walk back to where the piece's text starts.
    let start = hit.offset
    while (start > 0 && text.slice(start, start + expected.length) !== expected) start -= 1
    checked += 1
    if (text.slice(start, start + expected.length) !== expected) {
      mismatched.push(expected)
      continue
    }
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + expected.length)
    const real = range.getBoundingClientRect()
    // Glyph boxes on both sides: a span's own box is its whole line, taller than the text.
    const own = document.createRange()
    own.selectNodeContents(piece)
    const drawn = own.getBoundingClientRect()
    maxDriftPx = Math.max(
      maxDriftPx,
      Math.abs(real.left - drawn.left),
      Math.abs(real.top - drawn.top),
    )
  }
  return { pieces: pieces.length, checked, mismatched, maxDriftPx }
}

/** Page-side: every finite animation paused at the same moment of its timeline. */
function freezeAt(ms: number): number {
  let frozen = 0
  for (const animation of document.getAnimations()) {
    const end = animation.effect?.getComputedTiming().endTime
    if (typeof end !== 'number' || !Number.isFinite(end)) continue
    animation.pause()
    animation.currentTime = ms
    frozen += 1
  }
  return frozen
}

function resume(): void {
  for (const animation of document.getAnimations()) animation.play()
}

async function filmstrip(page: Page, step: (label: string) => Promise<void>, label: string) {
  for (const ms of [120, 300, 600, 1000, 1500]) {
    await page.evaluate(freezeAt, ms)
    await step(`${label}-${ms}ms`)
  }
}

async function editorText(page: Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-transitions-editor] .editor-virtualized-row'),
      (row) => row.textContent ?? '',
    ).join('\n'),
  )
}

let report: unknown = null

export const devTransitions: Scenario = {
  name: 'dev-transitions',
  description:
    'Step the /dev transitions editor through a refactor in slow motion: pieces move mid-flight, land exactly on the real text, and the real rows come back when the morph ends.',
  capture: { width: 900, height: 900 },
  async run(page, { step }) {
    const url = new URL(page.url())
    url.pathname = '/dev/transitions'
    url.search = ''
    url.hash = ''
    await page.goto(url.href)
    await morphSelectors.editor(page).locator('.editor-virtualized-row').first().waitFor()
    await page.waitForTimeout(1500)
    await step('start')

    await selectors.physicalSwitch(page, 'Slow motion').click()
    await selectors.physicalButton(page, 'Next').click()
    await page.locator(morphSelectors.piece).first().waitFor({ state: 'attached' })
    await filmstrip(page, step, 'next')
    const landing = await page.evaluate(parkAndCompare, morphSelectors.piece)
    await step('next-parked-at-end')
    await page.evaluate(resume)
    await page.locator(morphSelectors.layer).waitFor({ state: 'detached', timeout: 10_000 })
    await step('next-settled')
    ok((await editorText(page)).includes('items.reduce'), 'the editor holds step 2')

    await selectors.physicalButton(page, 'Undo').click()
    await page.locator(morphSelectors.piece).first().waitFor({ state: 'attached' })
    await filmstrip(page, step, 'undo')
    await page.evaluate(resume)
    await page.locator(morphSelectors.layer).waitFor({ state: 'detached', timeout: 10_000 })
    ok((await editorText(page)).includes('let sum = 0'), 'undo restores step 1')

    await selectors.physicalButton(page, 'Redo').click()
    await page.waitForTimeout(300)
    // A second change mid-flight restarts the motion from where the pieces are.
    await selectors.physicalButton(page, 'Next').click()
    await page.waitForTimeout(600)
    await step('retarget-mid-flight')
    await page.locator(morphSelectors.layer).waitFor({ state: 'detached', timeout: 10_000 })

    await selectors.physicalButton(page, 'Stream a function').click()
    await page.waitForTimeout(1600)
    await step('stream-mid-flight')
    await page.waitForTimeout(1200)
    await step('stream-later')
    await page.locator(morphSelectors.layer).waitFor({ state: 'detached', timeout: 20_000 })
    await step('stream-settled')
    ok((await editorText(page)).includes('totalWithTax'), 'the streamed function landed')

    const visible = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-transitions-editor] .editor-virtualized-row'),
        (row) => getComputedStyle(row).opacity,
      ),
    )
    report = { landing }
    ok(landing.checked > 20, `enough pieces checked: ${landing.checked}`)
    strictEqual(landing.mismatched.length, 0, `pieces over other text: ${landing.mismatched}`)
    ok(landing.maxDriftPx <= 0.5, `pieces land on the real text: ${landing.maxDriftPx}px`)
    ok(
      visible.every((opacity) => opacity === '1'),
      'the real rows are visible once settled',
    )
  },
  inspect: async () => report,
}
