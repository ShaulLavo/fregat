import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import {
  diffPaneSelector,
  diffPaneSyntaxReadySelector,
  openGitPanel,
  selectors,
} from '../selectors'
import { createScriptError } from '../../structured-errors'

const BEFORE = ['const first = 1;', 'const second = 2;', 'const third = 3;', 'const fourth = 4;']
const AFTER = [
  'const first = 1;',
  'const second = 9;',
  'const third = 3;',
  'const fourth = 4;',
  'const fifth = 5;',
]

type Paint = { readonly consts: number; readonly misaligned: readonly string[] }

export const gitDiffCrlfSyntax: Scenario = {
  name: 'git-diff-crlf-syntax',
  description:
    'Open the diff of a CRLF TypeScript file from the git panel: every `const` in both panes is one whole syntax-coloured span and the word tint covers exactly the changed digits. The step label counts consts and misaligned ones.',
  async run(page, { step }) {
    const fixture = await createGitFixture('diff-crlf-syntax')
    try {
      await writeFile(path.join(fixture, 'crlf.ts'), `${BEFORE.join('\r\n')}\r\n`)
      await fixtureGit(fixture, ['add', 'crlf.ts'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await writeFile(path.join(fixture, 'crlf.ts'), `${AFTER.join('\r\n')}\r\n`)
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).filter({ hasText: 'crlf.ts' }).first().click()
      await waitForSyntax(page)

      const paint = await paintedConsts(page)
      const tint = await inlineTint(page)
      await step(`consts-${paint.consts}-misaligned-${paint.misaligned.length}`)
      assertPaint(paint, tint)
    } finally {
      await releaseFixture(fixture)
    }
  },
}

function assertPaint(paint: Paint, tint: readonly string[]): void {
  if (paint.consts === 0) throw createScriptError('The diff panes showed no `const` to check')
  if (paint.misaligned.length > 0) {
    throw createScriptError(
      `${paint.misaligned.length} of ${paint.consts} consts were not one whole coloured span: ${JSON.stringify(paint.misaligned)}`,
    )
  }
  const sorted = [...tint].sort()
  if (JSON.stringify(sorted) !== JSON.stringify(['2', '9'])) {
    throw createScriptError(
      `The word tint covered ${JSON.stringify(sorted)}, not the changed digits`,
    )
  }
}

// Every pane reports its syntax landed and has painted token ranges; colouring is then final.
async function waitForSyntax(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ paneSelector, readySelector }) => {
      const panes = [...document.querySelectorAll(paneSelector)]
      if (panes.length === 0 || panes.some((pane) => !pane.matches(readySelector))) return false
      const painted = new Set<Element>()
      for (const [name, highlight] of CSS.highlights) {
        if (!name.startsWith('editor-shared-token-')) continue
        for (const range of highlight as unknown as Iterable<AbstractRange>) {
          const pane = range.startContainer.parentElement?.closest(paneSelector)
          if (pane) painted.add(pane)
        }
      }
      return panes.every((pane) => painted.has(pane))
    },
    { paneSelector: diffPaneSelector, readySelector: diffPaneSyntaxReadySelector },
    { timeout: 15_000 },
  )
}

async function paintedConsts(page: Page): Promise<Paint> {
  return page.evaluate(
    ({ paneSelector, source }) =>
      (new Function(`return (${source})`)() as (selector: string) => Paint)(paneSelector),
    { paneSelector: diffPaneSelector, source: PAINTED_CONSTS },
  )
}

async function inlineTint(page: Page): Promise<readonly string[]> {
  return page.evaluate((paneSelector) => {
    const texts: string[] = []
    for (const [name, highlight] of CSS.highlights) {
      if (!name.endsWith('-inline')) continue
      for (const range of highlight as unknown as Iterable<AbstractRange>) {
        if (!range.startContainer.parentElement?.closest(paneSelector)) continue
        texts.push(
          (range.startContainer.textContent ?? '').slice(range.startOffset, range.endOffset),
        )
      }
    }
    return texts
  }, diffPaneSelector)
}

// Page-side source, not a function: a transpiled function's `toString` can reference helpers the
// page does not have. For each `const` a pane shows, the syntax-token range painted over its first
// character must start there and end five characters later.
const PAINTED_CONSTS = `(paneSelector) => {
  const ranges = new Map()
  for (const [name, highlight] of CSS.highlights.entries()) {
    if (!name.startsWith('editor-shared-token-')) continue
    for (const range of highlight) {
      const node = range.startContainer
      if (!node.parentElement?.closest(paneSelector)) continue
      const end = range.endContainer === node ? range.endOffset : Infinity
      if (!ranges.has(node)) ranges.set(node, [])
      ranges.get(node).push([range.startOffset, end])
    }
  }
  let consts = 0
  const misaligned = []
  for (const pane of document.querySelectorAll(paneSelector)) {
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.closest('[data-editor-virtual-row]')) continue
      const text = node.textContent ?? ''
      for (const match of text.matchAll(/const/g)) {
        consts += 1
        const covering = (ranges.get(node) ?? []).find(([start, end]) => start <= match.index && end > match.index)
        if (covering && covering[0] === match.index && covering[1] === match.index + 5) continue
        misaligned.push(covering ? text.slice(covering[0], Math.min(covering[1], text.length)) : '(plain)')
      }
    }
  }
  return { consts, misaligned }
}`
