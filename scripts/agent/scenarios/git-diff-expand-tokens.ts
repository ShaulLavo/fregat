import type { Page } from 'playwright'
import type { Scenario } from './index'
import {
  createModifiedFileFixture,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { diffPaneSelector, openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const FILLER = Array.from({ length: 30 }, (_, index) => `export const filler${index} = '${index}'`)
const BEFORE = ['export function first(): number {', '  return 1', '}', ...FILLER, 'const tail = 1']
const AFTER = ['export function first(): number {', '  return 2', '}', ...FILLER, 'const tail = 2']

type FrameSample = { readonly rows: number; readonly tokenRanges: number }

export const gitDiffExpandTokens: Scenario = {
  name: 'git-diff-expand-tokens',
  description:
    'Expand and collapse unchanged context in a TypeScript diff while sampling every frame: the rows keep their syntax colours in every frame, because the tokens travel with the text (E050 row 1).',
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture('diff-expand-tokens', 'a.ts', BEFORE, AFTER)
    try {
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()
      await selectors.diffExpandRows(page).first().waitFor({ timeout: 15_000 })
      await waitForTokens(page)
      await step('diff-open')

      for (const action of ['expanded', 'collapsed'] as const) {
        await startSampling(page)
        await selectors.diffExpandRows(page).first().click()
        await page.waitForTimeout(600)
        const samples = await stopSampling(page)
        await step(action)
        assertColouredFrames(samples, action)
      }
    } finally {
      await releaseFixture(fixture)
    }
  },
}

function assertColouredFrames(samples: readonly FrameSample[], action: string): void {
  if (samples.length === 0) throw createScriptError(`No frames were sampled while ${action}`)
  const bare = samples.filter((sample) => sample.rows > 0 && sample.tokenRanges === 0)
  if (bare.length > 0) {
    throw createScriptError(
      `${bare.length} of ${samples.length} frames showed diff rows without syntax colour while ${action}`,
    )
  }
}

async function waitForTokens(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ paneSelector, countSource }) =>
      (new Function(`return (${countSource})`)() as (selector: string) => number)(paneSelector) > 0,
    { paneSelector: diffPaneSelector, countSource: COUNT_TOKEN_RANGES },
    { timeout: 15_000 },
  )
}

// Page-side source, not a function: a transpiled function's `toString` can reference helpers the
// page does not have. Counts syntax-token ranges whose text sits inside the diff pane.
const COUNT_TOKEN_RANGES = `(paneSelector) => {
  let count = 0
  for (const [name, highlight] of CSS.highlights.entries()) {
    if (!name.startsWith('editor-shared-token-')) continue
    for (const range of highlight) {
      if (range.startContainer.parentElement?.closest(paneSelector)) count += 1
    }
  }
  return count
}`

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(
    ({ paneSelector, countSource }) => {
      const count = new Function(`return (${countSource})`)() as (selector: string) => number
      const samples: FrameSample[] = []
      const state = { samples, running: true }
      Reflect.set(window, '__diffTokenSampler', state)
      const sample = () => {
        if (!state.running) return
        samples.push({
          rows: document.querySelectorAll(`${paneSelector} [data-editor-virtual-row]`).length,
          tokenRanges: count(paneSelector),
        })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    },
    { paneSelector: diffPaneSelector, countSource: COUNT_TOKEN_RANGES },
  )
}

async function stopSampling(page: Page): Promise<readonly FrameSample[]> {
  return page.evaluate(() => {
    const state = Reflect.get(window, '__diffTokenSampler') as {
      samples: FrameSample[]
      running: boolean
    }
    state.running = false
    return state.samples
  })
}
