import type { Scenario } from './index'
import type { Page } from 'playwright'
import {
  createModifiedFileFixture,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const FILLER = Array.from({ length: 12 }, (_, index) => `const filler${index} = ${index}`)
const BEFORE = [...FILLER, 'const limit = 10', 'call(first, second) => void', 'tail()']
const AFTER = [
  ...FILLER,
  'const limit = 20',
  'call(',
  '  first,',
  '  second,',
  ') => void',
  'tail()',
]

export const gitDiffInlineTint: Scenario = {
  name: 'git-diff-inline-tint',
  description:
    'Open a diff whose change is one line becoming several: the word tint must be there on open, stay the same across a hide/unhide of unmodified lines, and never cover a whole added line.',
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture('diff-tint', 'a.ts', BEFORE, AFTER)
    try {
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()
      await selectors.diffExpandRows(page).first().waitFor({ timeout: 15_000 })

      const opened = await settledTint(page)
      await step('diff-open')
      assertTint(opened, 'on open')

      await selectors.diffExpandRows(page).first().click()
      await step('unhidden')
      await selectors.diffExpandRows(page).first().click()
      const toggled = await settledTint(page)
      await step('hidden-again')
      assertTint(toggled, 'after hide/unhide')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

function assertTint(tinted: readonly string[], when: string): void {
  if (!tinted.includes('10') || !tinted.includes('20')) {
    throw createScriptError(`The changed word carried no tint ${when}: ${JSON.stringify(tinted)}`)
  }
  if (tinted.some((text) => text.includes('second,'))) {
    throw createScriptError(`A whole added line was tinted ${when}: ${JSON.stringify(tinted)}`)
  }
}

async function settledTint(page: Page): Promise<readonly string[]> {
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const texts: string[] = []
    for (const [name, highlight] of CSS.highlights) {
      if (!name.endsWith('-inline')) continue

      for (const range of highlight as unknown as Iterable<AbstractRange>) {
        const text = range.startContainer.textContent ?? ''
        texts.push(text.slice(range.startOffset, range.endOffset))
      }
    }
    return texts
  })
}
