import { strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { createGitFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import {
  EDITOR_ROW_LAYERS,
  focusEditor,
  focusedEditorInputText,
  openFileFromTree,
  waitForApp,
} from '../selectors'

type Route = 'edit-context' | 'textarea'
type RouteResult = {
  readonly restoredElement: string | undefined
  readonly element: string | undefined
  readonly line: string
  readonly accessibleValue: string | null
}

// Each file's first line names it, so a result can only come from the file it was typed into.
const FILES: Record<Route, { readonly name: string; readonly firstLine: string }> = {
  'edit-context': { name: 'a.txt', firstLine: 'one' },
  textarea: { name: 'b.txt', firstLine: 'two' },
}

/** What the accessibility tree hands a screen reader as the editor input's value. */
async function accessibleValue(page: Page): Promise<string | null> {
  const cdp = await page.context().newCDPSession(page)
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodes } = await cdp.send('Accessibility.queryAXTree', {
    nodeId: root.nodeId,
    accessibleName: 'Editor input',
    role: 'textbox',
  })
  await cdp.detach()
  const value = nodes.find((node) => !node.ignored)?.value?.value
  return typeof value === 'string' ? value : null
}

/** Text of each mounted, live row in document order; retired rows stay in the DOM but hidden. */
async function rowTexts(page: Page): Promise<string[]> {
  return page.evaluate((layers) => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('.editor-virtualized-row:not([hidden])'),
    ).toSorted(
      (left, right) =>
        Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
    )
    return rows.map((row) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      let text = ''
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.closest(layers)) text += node.nodeValue ?? ''
      }
      return text
    })
  }, EDITOR_ROW_LAYERS)
}

/**
 * Types, composes through a real IME, then lets the IME correct the word typed first — the shape
 * of an autocorrection, a composition that replaces text behind the caret.
 */
async function drive(page: Page, route: Route): Promise<Omit<RouteResult, 'restoredElement'>> {
  const file = FILES[route]
  // A reloaded fixture workspace can leave the terminal holding focus, where the palette chord is lost.
  await openFileFromTree(page, file.name)
  await page.waitForFunction(
    ([layers, first]) => {
      const row = document.querySelector('.editor-virtualized-row:not([hidden])')
      if (!row) return false
      const clone = row.cloneNode(true) as HTMLElement
      for (const layer of clone.querySelectorAll(layers)) layer.remove()
      return clone.textContent === first
    },
    [EDITOR_ROW_LAYERS, file.firstLine] as const,
  )
  await focusEditor(page)
  await page.keyboard.press('Control+End')
  const element = await page.evaluate(() => document.activeElement?.tagName)
  await page.keyboard.type('hello')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 })
  await cdp.send('Input.insertText', { text: '日本' })
  const at = (await page.evaluate(focusedEditorInputText)).lastIndexOf('hello')
  await cdp.send('Input.imeSetComposition', {
    text: 'Hello',
    selectionStart: 5,
    selectionEnd: 5,
    replacementStart: at,
    replacementEnd: at + 5,
  })
  await cdp.send('Input.insertText', { text: 'Hello' })
  await cdp.detach()
  await page.waitForTimeout(300)
  const rows = await rowTexts(page)
  return {
    element,
    line: `${rows[0]}|${rows.at(-1)}`,
    accessibleValue: await accessibleValue(page),
  }
}

/** The element the editor restored for the open tab uses, read before anything is opened. */
async function restoredInputElement(page: Page): Promise<string | undefined> {
  const input = page.locator('.editor-virtualized-input').first()
  if ((await input.count()) === 0) return undefined
  return input.evaluate((element) => element.tagName)
}

let report: unknown = null

export const editorEditContextInput: Scenario = {
  name: 'editor-edit-context-input',
  description:
    'Switch editor.inputRoute between edit-context and textarea across reloads, then type, compose and autocorrect through a real IME in a fixture file on each.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page, ['editor.inputRoute'])
    const fixture = await createGitFixture('edit-context-input')
    try {
      await writeFile(join(fixture, 'a.txt'), `${FILES['edit-context'].firstLine}\n`)
      await writeFile(join(fixture, 'b.txt'), `${FILES.textarea.firstLine}\n`)
      await openFixtureWorkspace(page, fixture)
      const results: Partial<Record<Route, RouteResult>> = {}
      for (const route of ['edit-context', 'textarea'] as const) {
        await writeUserSetting(page, 'editor.inputRoute', route)
        // An editor takes its route when it is built, and the reload rebuilds the restored tab's.
        await page.reload()
        await waitForApp(page)
        await page.waitForTimeout(1000)
        const restoredElement = await restoredInputElement(page)
        results[route] = { restoredElement, ...(await drive(page, route)) }
        await step(`${route}-typed`)
      }
      report = results
      const expected: Record<Route, string> = { 'edit-context': 'DIV', textarea: 'TEXTAREA' }
      for (const route of ['edit-context', 'textarea'] as const) {
        const result = results[route]
        strictEqual(result?.element, expected[route], `${route} route mounts its element`)
        strictEqual(
          result?.line,
          `${FILES[route].firstLine}|Hello日本`,
          `${route} route applies every edit to its own file`,
        )
        strictEqual(
          result?.accessibleValue?.endsWith('Hello日本'),
          true,
          `${route} route exposes the lines around the caret to screen readers`,
        )
      }
      // The first pass left a.txt open, so the reload restores it before any setting query lands.
      strictEqual(
        results.textarea?.restoredElement,
        'TEXTAREA',
        'a restored editor takes the chosen route',
      )
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
