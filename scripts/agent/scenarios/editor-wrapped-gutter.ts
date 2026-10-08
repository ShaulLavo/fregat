import { deepStrictEqual, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import { createGitFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

const inspections = new WeakMap<Page, unknown>()

export const editorWrappedGutter: Scenario = {
  name: 'editor-wrapped-gutter',
  description: 'Wrap a long line and keep line numbers on the first display row of each line.',
  inspect: async (page) => inspections.get(page),
  async run(page, { step }) {
    const fixture = await createGitFixture('editor-wrapped-gutter')
    try {
      await writeFile(join(fixture, 'wrapped.txt'), `${'wrapped words '.repeat(80)}\nsecond line`)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'wrapped.txt')
      await focusEditor(page)
      await step('unwrapped')
      await runPaletteCommand(page, 'Toggle word wrap')
      const numbers = selectors.editorLineNumbers(page)
      await numbers.filter({ visible: true }).first().waitFor()
      await page.waitForFunction(
        (selector) => document.querySelectorAll(`${selector}[hidden]`).length > 0,
        selectors.editorLineNumberSelector,
      )
      const proof = await numbers.evaluateAll((elements) =>
        elements.map((element) => ({
          hidden: (element as HTMLElement).hidden,
          counter: getComputedStyle(element).counterSet,
          content: getComputedStyle(element, '::before').content,
        })),
      )
      inspections.set(page, proof)
      ok(
        proof.some((number) => number.hidden),
        'The long line has wrapped continuation rows',
      )
      deepStrictEqual(
        proof
          .filter((number) => !['none', 'normal', '""'].includes(number.content))
          .map((number) => number.counter),
        ['editor-line 1', 'editor-line 2'],
        'Only the first display row of each line paints its line number',
      )
      await step('wrapped')
      await runPaletteCommand(page, 'Toggle word wrap')
      await step('unwrapped-again')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
