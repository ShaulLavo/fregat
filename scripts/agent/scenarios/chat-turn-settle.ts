import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

type RowBox = { id: string | null; type: string | null; top: number; height: number }
type TurnEvidence = {
  kind: 'no-tool' | 'tool'
  answerTopBefore: number
  answerTopAfter: number
  shift: number
  /** The Working row before the finish, and the finished status after it. */
  working: RowBox
  status: RowBox | undefined
  /** Rows between Working and the answer that the finished turn folds away. */
  foldedHeight: number
  rowsBefore: RowBox[]
  rowsAfter: RowBox[]
}

/** How long the turn runs after its answer lands, so the status reads whole seconds. */
const HOLD_MS = 1_500

/**
 * Owner rule (2026-09-27): the finished status takes the Working row's slot under the prompt, so
 * the answer holds still when a turn finishes. The fixture streams the whole answer while the
 * turn still runs and completes it only when told, so both sides of the finish are measured.
 */
export const chatTurnSettle = isolatedNativeScenario({
  name: 'chat-turn-settle',
  description:
    'A finished turn keeps its answer still: the Working row becomes the finished status in the same slot under the prompt, for a turn with no tool steps and for one with a tool.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root }) {
    const turns = [
      await settleTurn(page, root, step, 1, 'no-tool', 'Answer without tools.'),
      await settleTurn(page, root, step, 2, 'tool', 'Answer with a tool.'),
    ]
    await toggleToolFold(page, step)
    for (const turn of turns) {
      ok(
        Math.abs(turn.shift + turn.foldedHeight) <= 1,
        `The ${turn.kind} answer moved ${turn.shift}px; only the folded work (${turn.foldedHeight}px) may move it`,
      )
      const { status, working } = turn
      ok(
        (status?.type === 'turn-status' || status?.type === 'turn-fold') &&
          Math.abs(status.height - working.height) <= 1,
        `The ${turn.kind} status takes Working's slot: ${rowSummary([working])} became ${rowSummary(turn.rowsAfter)}`,
      )
    }
    return turns
  },
})

async function settleTurn(
  page: Page,
  root: string,
  step: (name: string) => Promise<void>,
  index: number,
  kind: TurnEvidence['kind'],
  prompt: string,
): Promise<TurnEvidence> {
  await sendPrompt(page, prompt)
  await waitForNative(root, 'settle-answered', index)
  await answer(page, index).waitFor()
  await page.getByText(/^Working for /).waitFor()
  await page.waitForTimeout(HOLD_MS)
  const rowsBefore = await rowBoxes(page)
  const answerTopBefore = await topOf(page, index)
  await step(`${kind}-working`)

  await writeFile(join(root, `settle-${index}`), 'end')
  await waitForNative(root, 'settle-ended', index)
  await selectors.chatStop(page).waitFor({ state: 'hidden', timeout: 30_000 })
  await page.getByText(/^Working for /).waitFor({ state: 'detached' })
  // Past the row measurement and any scroll the finish might trigger.
  await page.waitForTimeout(600)
  const rowsAfter = await rowBoxes(page)
  const answerTopAfter = await topOf(page, index)
  await step(`${kind}-finished`)

  const workingIndex = rowsBefore.findIndex((row) => row.type === 'working')
  const working = rowsBefore[workingIndex]
  ok(working, `The ${kind} turn showed Working while it ran: ${rowSummary(rowsBefore)}`)
  const status = rowsAfter.find((row) => Math.abs(row.top - working.top) <= 1)
  const answerIndex = rowsBefore.findIndex(
    (row, rowIndex) => rowIndex > workingIndex && row.type === 'message',
  )
  const foldedHeight = rowsBefore
    .slice(workingIndex + 1, answerIndex)
    .reduce((sum, row) => sum + row.height, 0)
  const turn: TurnEvidence = {
    kind,
    answerTopBefore,
    answerTopAfter,
    shift: Math.round((answerTopAfter - answerTopBefore) * 10) / 10,
    working,
    status,
    foldedHeight,
    rowsBefore,
    rowsAfter,
  }
  console.log(
    `chat-turn-settle ${kind}: answer ${answerTopBefore} -> ${answerTopAfter} (shift ${turn.shift}px, folded work ${foldedHeight}px)`,
  )
  console.log(`  before ${rowSummary(rowsBefore)}\n  after  ${rowSummary(rowsAfter)}`)
  return turn
}

/** The tool turn's status is its fold: hovering, opening and closing it work as before. */
async function toggleToolFold(page: Page, step: (name: string) => Promise<void>) {
  const fold = selectors.completedWorkGroup(page).first()
  await fold.hover()
  await step('tool-fold-hover')
  await fold.click()
  await selectors.chatMessages(page).getByText('echo SETTLE_TOOL').waitFor()
  await step('tool-fold-expanded')
  await fold.click()
  await selectors.chatMessages(page).getByText('echo SETTLE_TOOL').waitFor({ state: 'detached' })
  await step('tool-fold-closed')
}

function answer(page: Page, index: number) {
  return selectors.chatMessages(page).getByText(`SETTLE_ANSWER_${index}`)
}

async function topOf(page: Page, index: number) {
  const box = await answer(page, index).boundingBox()
  ok(box, 'The answer is laid out')
  return Math.round(box.y * 10) / 10
}

async function rowBoxes(page: Page): Promise<RowBox[]> {
  return selectors.timelineRows(page).evaluateAll((rows) =>
    rows.map((row) => {
      const rect = row.getBoundingClientRect()
      return {
        id: row.getAttribute('data-timeline-row-id'),
        type: row.getAttribute('data-timeline-row-type'),
        top: Math.round(rect.top * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      }
    }),
  )
}

function rowSummary(rows: readonly RowBox[]) {
  return rows.map((row) => `${row.type}@${row.top}+${row.height}`).join(' ')
}

async function waitForNative(root: string, event: string, index: number) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const entries = await nativeLog(root)
    if (entries.some((entry) => entry.event === event && entry.index === index)) return
    await Bun.sleep(100)
  }
  ok(false, `The fixture never recorded ${event} for turn ${index}`)
}
