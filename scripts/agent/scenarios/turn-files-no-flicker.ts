import { ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { countBlankFrames, recordFrames } from '../blank-frames'
import { selectors } from '../selectors'
import { prepareFixture, showTurnScope } from './checkpoint-states'
import { isolatedNativeScenario } from './native-provider-verification'

export const turnFilesNoFlicker = isolatedNativeScenario({
  name: 'turn-files-no-flicker',
  description:
    'Select successive fixture turns with delayed checkpoint reads and retain their hunks and counts.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: prepareFixture,
  async drive(page, { root, step, worktreePath }) {
    await writeFile(
      join(root, 'checkpoint-control.json'),
      JSON.stringify({
        cwd: worktreePath,
        hold: false,
        turns: [2, 3, 4].map((value) => [
          { op: 'write', path: 'src/app.ts', text: `export const app = ${value}\n` },
        ]),
      }),
    )
    await page.route('**/orchestration/turn-diff?*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      await route.continue()
    })
    for (let turn = 1; turn <= 3; turn += 1) {
      await selectors.chatMessage(page).fill(`Edit the app for turn ${turn}.`)
      await selectors.chatSend(page).click()
      await selectors
        .chatMessages(page)
        .getByText('CHECKPOINT_TURN_DONE')
        .nth(turn - 1)
        .waitFor({ timeout: 30_000 })
      await selectors
        .changedFilesSections(page)
        .nth(turn - 1)
        .waitFor({ timeout: 30_000 })
      if (turn === 1) {
        await showTurnScope(page)
        await page.locator(selectors.turnHunkSelector).first().waitFor()
        await step('first-turn-loaded')
        continue
      }
      let blank = 0
      const frames = await recordFrames<{ header: string; body: string }>(
        page,
        `() => ({
        header: document.querySelector(${JSON.stringify(selectors.turnFilesHeaderSelector)})?.textContent ?? '',
        body: document.querySelector(${JSON.stringify(selectors.turnHunkSelector)})?.textContent ?? '',
      })`,
        async () => {
          blank = await countBlankFrames(page, selectors.turnHunkSelector, async () => {
            await selectors.gitDiffScope(page, 'Turn').click()
            await selectors
              .turnFiles(page)
              .getByRole('treeitem', { name: new RegExp('app = ' + turn) })
              .waitFor()
            await page.waitForTimeout(700)
          })
        },
      )
      await step(`turn-${turn}-blank-frames-${blank}`)
      strictEqual(blank, 0, 'Turn hunks disappeared while reading the next checkpoint')
      ok(frames.length > 0, 'Turn frames were sampled')
      ok(
        frames.every((frame) => !frame.header.includes('0 changes')),
        'Loading never reads as zero changes',
      )
      ok(
        frames.every((frame) => {
          const shownTurn = Number(/Turn (\d+)/.exec(frame.header)?.[1])
          return frame.body.includes(`app = ${shownTurn}`)
        }),
        'Every header names the turn whose hunk is shown',
      )
    }
  },
})
