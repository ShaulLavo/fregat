import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Scenario } from './index'
import { createGitFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import {
  fileTransitionSelectors,
  openFileFromTree,
  paintedTokenColors,
  selectors,
} from '../selectors'

const FILE = 'file-transition.ts'
const TEXT = Array.from(
  { length: 24 },
  (_, index) => `export const value${index} = { label: 'row ${index}', count: ${index} }\n`,
).join('')

type Reveal = {
  readonly hiddenAt: number | null
  readonly revealAt: number | null
  readonly doneAt: number | null
  readonly pieces: number
}

/** Page-side: when the rows were hidden, when the overlay appeared and how many pieces it drew, and when the rows came back. */
function recordReveal(selectorsForTransition: typeof fileTransitionSelectors): void {
  const record: {
    hiddenAt: number | null
    revealAt: number | null
    doneAt: number | null
    pieces: number
  } = { hiddenAt: null, revealAt: null, doneAt: null, pieces: 0 }
  Reflect.set(window, '__agentFileTransition', record)
  const observe = () => {
    const now = Math.round(performance.now())
    const active = document.querySelector(selectorsForTransition.active) !== null
    if (active && record.hiddenAt === null) record.hiddenAt = now
    if (!active && record.hiddenAt !== null && record.doneAt === null) record.doneAt = now
    const layer = document.querySelector(selectorsForTransition.layer)
    if (!layer || record.revealAt !== null) return
    record.revealAt = now
    record.pieces = layer.querySelectorAll(selectorsForTransition.piece).length
  }
  new MutationObserver(observe).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  })
}

let report: unknown = null

export const editorFileTransition: Scenario = {
  name: 'editor-file-transition-reveal',
  description:
    'Turn on editor.fileTransition.mode diffusion (restored afterwards), open a TypeScript fixture file and record the reveal: the rows hide on open, the overlay draws the file, and the rows come back highlighted.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page, ['editor.fileTransition.mode'])
    const fixture = await createGitFixture('editor-file-transition-reveal')
    try {
      await writeUserSetting(page, 'editor.fileTransition.mode', 'diffusion')
      await writeFile(join(fixture, FILE), TEXT)
      await openFixtureWorkspace(page, fixture)
      await page.evaluate(recordReveal, fileTransitionSelectors)
      await openFileFromTree(page, FILE)
      await page
        .locator(fileTransitionSelectors.layer)
        .waitFor({ state: 'attached', timeout: 15_000 })
      await step('revealing')
      await page.waitForFunction(
        () => (Reflect.get(window, '__agentFileTransition') as Reveal).doneAt !== null,
        undefined,
        { timeout: 15_000 },
      )
      const reveal = await page.evaluate(
        () => Reflect.get(window, '__agentFileTransition') as Reveal,
      )
      const colours = await paintedTokenColors(selectors.editorInput(page).first())
      await step('revealed')

      report = { reveal, paintedTokenColours: colours.length }
      ok(reveal.hiddenAt !== null, 'the rows hide when the file opens')
      ok(reveal.revealAt !== null && reveal.revealAt >= reveal.hiddenAt, 'the overlay starts')
      ok(reveal.pieces > 0, 'the overlay draws the file')
      ok(colours.length > 0, 'the revealed rows are highlighted')
    } finally {
      try {
        await restore()
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
  inspect: async () => report,
}
