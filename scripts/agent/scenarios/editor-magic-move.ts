import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { createGitFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { fileEditAnimationSelectors, openFileFromTree, selectors } from '../selectors'

const SHARED = [
  "import { createStore } from './store'",
  '',
  'export function total(items: readonly number[]): number {',
  '  return items.reduce((sum, item) => sum + item, 0)',
  '}',
]
const FIRST = SHARED.concat(['', 'export const first = total([1, 2, 3])', '']).join('\n')
// The same function, moved down under new code, with one line changed.
const SECOND = [
  "import { createStore } from './store'",
  '',
  'const store = createStore()',
  'export const second = store.read()',
  '',
]
  .concat(SHARED.slice(2), [''])
  .join('\n')

type Motion = { readonly moving: number; readonly entering: number; readonly pieces: number }

/** Page-side: freezes every animation at `ms` and counts overlay pieces moving and entering. */
function motionAt({ ms, selector }: { ms: number; selector: string }): Motion {
  let moving = 0
  let entering = 0
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null
    const end = effect?.getComputedTiming().endTime
    if (typeof end !== 'number' || !Number.isFinite(end)) continue
    animation.pause()
    animation.currentTime = ms
    const target = effect?.target
    if (!(target instanceof HTMLElement) || !target.matches(selector)) continue
    const transform = String(effect?.getKeyframes()[0]?.transform ?? '')
    // Entering text rises from below its row; moving text starts from its old place.
    if (transform.startsWith('translateY')) entering += 1
    else if (transform.startsWith('translate(') && !/^translate\(0(px)?, 0(px)?\)$/.test(transform))
      moving += 1
  }
  return { moving, entering, pieces: document.querySelectorAll(selector).length }
}

const reports = new WeakMap<Page, Motion>()

export const editorMagicMove: Scenario = {
  name: 'editor-magic-move',
  description:
    'Turn on the magicMove file transition (restored afterwards), open one fixture file and then another that shares a function with it: the shared text slides from the first file to its place in the second.',
  inspect: async (page) => reports.get(page),
  async run(page, { step }) {
    const restore = await preserveAppearance(page, ['editor.fileTransition.mode'])
    const fixture = await createGitFixture('editor-magic-move')
    try {
      await writeUserSetting(page, 'editor.fileTransition.mode', 'magicMove')
      await writeFile(join(fixture, 'first.ts'), FIRST)
      await writeFile(join(fixture, 'second.ts'), SECOND)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'first.ts')
      await page.locator(fileEditAnimationSelectors.layer).waitFor({ state: 'detached' })
      await page.waitForTimeout(800)
      await step('first')

      await openFileFromTree(page, 'second.ts')
      await page.locator(fileEditAnimationSelectors.piece).first().waitFor({ state: 'attached' })
      const motion = await page.evaluate(motionAt, {
        ms: 200,
        selector: fileEditAnimationSelectors.piece,
      })
      reports.set(page, motion)
      await step('moving')
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.play()
      })
      await page
        .locator(fileEditAnimationSelectors.layer)
        .waitFor({ state: 'detached', timeout: 10_000 })
      await step('settled')
      const text = await selectors.editorSurface(page).first().innerText()

      ok(motion.moving > 5, `shared text moves: ${motion.moving}`)
      ok(motion.entering > 0, `new text enters: ${motion.entering}`)
      ok(text.includes('export const second'), 'the second file is open')
    } finally {
      try {
        await restore()
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
}
