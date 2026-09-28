import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import {
  editorRowSelector,
  markdownEditorLinkSelector,
  openFileFromTree,
  selectors,
} from '../selectors'
import type { Scenario } from './index'

const table = [
  ['Work', 'Details'],
  ['---', '---'],
  ['[short](target.md)', '**bold**'],
  ['[a longer label](target.md)', '`code`'],
].map(([left = '', right = '']) => `| ${left.padEnd(36)} | ${right.padEnd(14)} |`)
const source = [
  '# Markdown links',
  '',
  '[outside](https://example.com/docs) and [reference][destination]',
  '',
  ...table,
  '',
  '[destination]: target.md',
  '',
].join('\n')

export const markdownLinks: Scenario = {
  name: 'markdown-links',
  description:
    'Formatted links open their destinations and table pipes stay aligned from first visible paint through reload.',
  async run(page, { evidence, step }) {
    const fixture = await mkdtemp(scratchPath('fregat-markdown-links-'))
    const file = path.join(fixture, 'links.md')
    const frames: unknown[] = []
    await page.exposeFunction('recordMarkdownRows', (rows: unknown) => frames.push(rows))
    await page.addInitScript(
      ({ rowSelector }) => {
        let previous = ''
        const observe = () => {
          const rows = Array.from(document.querySelectorAll(rowSelector))
            .filter((row) => row.checkVisibility({ visibilityProperty: true }))
            .map((row) => row.textContent)
          const value = JSON.stringify(rows)
          if (value !== previous) {
            previous = value
            Reflect.get(window, 'recordMarkdownRows')(rows)
          }
          requestAnimationFrame(observe)
        }
        requestAnimationFrame(observe)
      },
      { rowSelector: editorRowSelector },
    )
    try {
      await writeFile(file, source)
      await writeFile(path.join(fixture, 'target.md'), '# Link target\n\nDestination reached.\n')
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'links.md')
      const links = page.locator(markdownEditorLinkSelector)
      await links.filter({ hasText: 'short' }).waitFor()
      await step('formatted-links-and-table')
      const rendered = await selectors.editorRows(page).allTextContents()
      const renderedTable = rendered.filter((row) => row.startsWith('|'))
      const pipes = (rows: readonly string[]) =>
        rows.map((row) => Array.from(row.matchAll(/\|/g), (match) => match.index))
      deepStrictEqual(pipes(renderedTable), pipes(table))
      await assertTableGeometry(page)
      await links.filter({ hasText: 'short' }).click()
      await selectors.editorRows(page).filter({ hasText: 'Destination reached.' }).waitFor()
      await step('table-link-opened-file')
      await openFileFromTree(page, 'links.md')
      await links.filter({ hasText: 'reference' }).focus()
      await page.keyboard.press('Enter')
      await selectors.editorRows(page).filter({ hasText: 'Destination reached.' }).waitFor()
      await step('reference-link-opened-file')
      await openFileFromTree(page, 'links.md')
      await page
        .context()
        .route('https://example.com/**', (route) =>
          route.fulfill({ body: 'External destination reached.' }),
        )
      const opened = page.context().waitForEvent('page')
      await links.filter({ hasText: 'outside' }).click()
      const external = await opened
      await external.waitForURL('https://example.com/docs')
      await external.close()
      await step('external-link-opened')
      frames.length = 0
      await page.reload({ waitUntil: 'domcontentloaded' })
      await links.filter({ hasText: 'short' }).waitFor()
      await page.waitForTimeout(1500)
      await step('reload-settled')
      await evidence.json('visible-frames.json', frames)
      strictEqual(
        frames.some(
          (frame) =>
            Array.isArray(frame) &&
            frame.some((row) => typeof row === 'string' && row.includes('[outside]')),
        ),
        false,
      )
      strictEqual(await links.count(), 4)
      deepStrictEqual(
        pipes(
          (await selectors.editorRows(page).allTextContents()).filter((row) => row.startsWith('|')),
        ),
        pipes(table),
      )
      strictEqual(await readFile(file, 'utf8'), source)
      await assertTableGeometry(page)
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function assertTableGeometry(page: Page) {
  const rows = await selectors.editorRows(page).evaluateAll((elements) =>
    elements
      .filter((element) => element.textContent?.startsWith('|'))
      .map((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const positions: number[] = []
        let node = walker.nextNode()
        while (node) {
          for (const match of (node.textContent ?? '').matchAll(/\|/g)) {
            const range = document.createRange()
            range.setStart(node, match.index)
            range.setEnd(node, match.index + 1)
            positions.push(range.getBoundingClientRect().x)
          }
          node = walker.nextNode()
        }
        return positions
      }),
  )
  for (const positions of rows) {
    positions.forEach((position, index) =>
      ok(Math.abs(position - rows[0]![index]!) < 1, 'Table pipes must align on screen'),
    )
  }
}
