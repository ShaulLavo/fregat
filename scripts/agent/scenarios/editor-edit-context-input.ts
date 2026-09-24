import { strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { createGitFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { focusEditor, openFileByName, waitForApp } from '../selectors'

type Route = 'edit-context' | 'textarea'
type RouteResult = {
  readonly element: string | undefined
  readonly line: string
  readonly accessibleValue: string | null
}

/** The window of text the focused input element holds, whichever route put it there. */
async function inputWindow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement as
      | (HTMLElement & { value?: string; editContext?: { text: string } | null })
      | null
    return active?.editContext?.text ?? active?.value ?? ''
  })
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

/** Rendered text of the last line, where every input below lands. */
async function lastLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.editor-virtualized-row'))
    const last = rows.toSorted(
      (left, right) =>
        Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
    )[rows.length - 1]
    return last?.textContent ?? ''
  })
}

/**
 * Types, composes through a real IME, then lets the IME correct the word typed first — the shape
 * of an autocorrection, a composition that replaces text behind the caret.
 */
async function drive(page: Page, file: string): Promise<RouteResult> {
  await openFileByName(page, file)
  await focusEditor(page)
  await page.keyboard.press('Control+End')
  const element = await page.evaluate(() => document.activeElement?.tagName)
  await page.keyboard.type('hello')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 })
  await cdp.send('Input.insertText', { text: '日本' })
  const at = (await inputWindow(page)).lastIndexOf('hello')
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
  return { element, line: await lastLine(page), accessibleValue: await accessibleValue(page) }
}

let report: unknown = null

export const editorEditContextInput: Scenario = {
  name: 'editor-edit-context-input',
  description:
    'Set editor.inputRoute to edit-context, type, compose and autocorrect through a real IME in a fixture file, with the textarea route as the control.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page, ['editor.inputRoute'])
    const fixture = await createGitFixture('edit-context-input')
    try {
      await writeFile(join(fixture, 'b.txt'), 'one\n')
      await openFixtureWorkspace(page, fixture)
      const results: Partial<Record<Route, RouteResult>> = {}
      for (const [route, file] of [
        ['edit-context', 'a.txt'],
        ['textarea', 'b.txt'],
      ] as const) {
        await writeUserSetting(page, 'editor.inputRoute', route)
        // Editors are built once per group and reused across tabs, so the route needs a reload.
        await page.reload()
        await waitForApp(page)
        results[route] = await drive(page, file)
        await step(`${route}-typed`)
      }
      report = results
      strictEqual(results['edit-context']?.element, 'DIV', 'EditContext route mounts its element')
      strictEqual(
        results['edit-context']?.line,
        'Hello日本',
        'EditContext route applies every edit',
      )
      strictEqual(results.textarea?.element, 'TEXTAREA', 'Textarea route stays the default element')
      strictEqual(results.textarea?.line, 'Hello日本', 'Textarea route applies the correction')
      for (const route of ['edit-context', 'textarea'] as const)
        strictEqual(
          results[route]?.accessibleValue?.endsWith('Hello日本'),
          true,
          `${route} exposes the lines around the caret to screen readers`,
        )
    } finally {
      await restore()
      await releaseFixture(fixture)
    }
  },
  inspect: async () => report,
}
