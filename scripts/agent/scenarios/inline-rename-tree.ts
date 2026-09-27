import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { committedFixture, openFixtureWorkspace } from '../fixture-workspace'
import { selectors } from '../selectors'
import { treeRow } from '../tree-parity/states'
import type { Scenario } from './index'

export const inlineRenameTree: Scenario = {
  name: 'inline-rename-tree',
  description:
    'Rename a disposable file, retaining its extension selection, composition, Escape and blur behavior.',
  async run(page, { step }) {
    const fixture = await committedFixture('inline-rename')
    try {
      await openFixtureWorkspace(page, fixture.path)
      await treeRow(page, 'a.txt').focus()
      await page.keyboard.press('F2')
      const input = selectors.treeRenameInput(page)
      await input.waitFor()
      deepStrictEqual(
        await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
        [0, 5],
      )
      const geometry = await input.evaluate((node) => {
        const style = getComputedStyle(node)
        return { boxSizing: style.boxSizing, height: node.getBoundingClientRect().height }
      })
      strictEqual(geometry.boxSizing, 'border-box')
      strictEqual(geometry.height, (await treeRow(page, 'a.txt').boundingBox())!.height - 4)
      await step('tree-renaming')
      await input.fill('cancelled.txt')
      await input.press('Escape')
      await input.waitFor({ state: 'hidden' })
      strictEqual(await readFile(path.join(fixture.path, 'a.txt'), 'utf8'), 'one\n')
      await page.keyboard.press('F2')
      await input.fill('renamed.txt')
      await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
      strictEqual(await input.isVisible(), true)
      const committed = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/fs/workspace-edit/commit',
      )
      await selectors.folderTree(page).click({ position: { x: 8, y: 250 } })
      strictEqual((await committed).status(), 200)
      await input.waitFor({ state: 'hidden' })
      await treeRow(page, 'renamed.txt').waitFor()
      strictEqual(await readFile(path.join(fixture.path, 'renamed.txt'), 'utf8'), 'one\n')
      await step('tree-renamed-on-blur')
    } finally {
      await fixture.release()
    }
  },
}
