import { strictEqual, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { countBlankFrames, recordFrames } from '../blank-frames'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import {
  focusEditor,
  openFileFromTree,
  runPaletteCommand,
  openGitPanel,
  selectors,
} from '../selectors'

type ComparisonFrame = { tab: string; body: string; busy: boolean }
const comparisonFrame = `() => ({
        tab: document.querySelector(${JSON.stringify(selectors.selectedComparisonTabSelector)})?.textContent ?? '',
        body: document.querySelector(${JSON.stringify(selectors.comparisonRowsSelector)})?.textContent ?? '',
        busy: document.querySelector(${JSON.stringify(selectors.selectedComparisonTabSelector)})?.getAttribute('aria-busy') === 'true',
      })`

export const diffNoFlicker: Scenario = {
  name: 'diff-no-flicker',
  description:
    'Switch split comparisons through delayed blob reads, retaining rows and their tab label.',
  async run(page, { step }) {
    const fixture = await createGitFixture('diff-no-flicker')
    try {
      for (const name of ['alpha', 'bravo', 'charlie']) {
        await writeFile(path.join(fixture, `${name}.txt`), `${name} before\n`)
      }
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      for (const name of ['alpha', 'bravo', 'charlie']) {
        await writeFile(path.join(fixture, `${name}.txt`), `${name} after\n`)
      }
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await page.route('**/git/diff/blob?*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 350))
        await route.continue()
      })
      await selectors.worktreeFiles(page).filter({ hasText: 'alpha.txt' }).click()
      await selectors.diffRows(page).filter({ hasText: 'alpha after' }).waitFor()
      if ((await selectors.diffPanes(page).count()) === 1)
        await runPaletteCommand(page, 'Toggle diff view mode')
      await selectors.diffPanes(page).nth(1).waitFor()
      await step('loaded')
      let blank = 0
      const frames = await recordFrames<ComparisonFrame>(page, comparisonFrame, async () => {
        blank = await countBlankFrames(page, selectors.comparisonRowsSelector, async () => {
          for (const name of ['bravo', 'charlie', 'alpha']) {
            await selectors
              .worktreeFiles(page)
              .filter({ hasText: name + '.txt' })
              .click()
            await selectors
              .diffRows(page)
              .filter({ hasText: name + ' after' })
              .waitFor()
          }
        })
      })
      await step(`blank-frames-${blank}`)
      strictEqual(blank, 0, 'switching comparisons blanked loaded rows')
      ok(
        frames.some((frame) => frame.busy),
        'the held tab shows a loading indicator',
      )
      ok(
        frames.every(({ tab, body }) => !body || tab.includes(body.split(' ')[0]!)),
        'tab names the shown comparison in every frame',
      )
    } finally {
      await releaseFixture(fixture)
    }
  },
}

export const savedComparisonNoFlicker: Scenario = {
  name: 'saved-comparison-no-flicker',
  description: 'Switch saved comparisons between dirty fixture buffers and count blank frames.',
  async run(page, { step }) {
    const fixture = await createGitFixture('saved-comparison-no-flicker')
    try {
      for (const name of ['alpha', 'bravo']) {
        await writeFile(path.join(fixture, `${name}.txt`), `${name} saved\n`)
      }
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      for (const name of ['alpha', 'bravo']) {
        await openFileFromTree(page, `${name}.txt`)
        await focusEditor(page)
        await page.keyboard.press('Control+Home')
        await page.keyboard.type(`${name} dirty `)
        await runPaletteCommand(page, 'Compare with saved')
        await selectors
          .diffRows(page)
          .filter({ hasText: `${name} dirty` })
          .waitFor()
      }
      await step('loaded')
      let blank = 0
      const frames = await recordFrames<ComparisonFrame>(page, comparisonFrame, async () => {
        blank = await countBlankFrames(page, selectors.comparisonRowsSelector, async () => {
          for (const name of ['alpha', 'bravo', 'alpha']) {
            await selectors
              .editorGroupTabs(page, 0)
              .filter({ hasText: `${name}.txt (working tree)` })
              .click()
            await selectors
              .diffRows(page)
              .filter({ hasText: `${name} dirty` })
              .waitFor()
          }
        })
      })
      ok(
        frames.every(({ tab, body }) => !body || tab.includes(body.split(' ')[0]!)),
        `saved tab names the shown body: ${JSON.stringify(frames.filter(({ tab, body }) => body && !tab.includes(body.split(' ')[0]!)))}`,
      )
      await step(`blank-frames-${blank}`)
      strictEqual(blank, 0, 'saved comparison lost rows between buffers')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

export const historyComparisonNoFlicker: Scenario = {
  name: 'history-comparison-no-flicker',
  description: 'Arrow through history comparisons without dropping the previous editor rows.',
  async run(page, { step }) {
    const fixture = await createGitFixture('history-comparison-no-flicker')
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.txt')
      await focusEditor(page)
      for (const text of ['alpha', 'bravo', 'charlie', 'delta']) {
        await page.keyboard.press('End')
        await page.keyboard.type(text)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(600)
      }
      await runPaletteCommand(page, 'Show history')
      await selectors.historyState(page, 0).click()
      await selectors.diffRows(page).first().waitFor()
      await step('loaded')
      const blank = await countBlankFrames(page, selectors.comparisonRowsSelector, async () => {
        await selectors.historyStates(page).focus()
        for (let index = 0; index < 3; index += 1) {
          await page.keyboard.press('Shift+ArrowRight')
          await page.waitForTimeout(150)
        }
      })
      await step(`blank-frames-${blank}`)
      strictEqual(blank, 0, 'history comparisons blanked loaded rows')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
