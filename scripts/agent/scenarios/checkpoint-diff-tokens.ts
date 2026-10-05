import { ok } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import {
  diffPaneSelector,
  editorRowSelector,
  selectors,
  sharedTokenHighlightPrefix,
} from '../selectors'
import { isolatedNativeScenario, writeSettings } from './native-provider-verification'
import { readCaches } from '../cache-snapshot'

const FILES = ['first', 'second'] as const
const EDITED = new Set([5, 30])
// Re-indented next to the line 5 edit: the whitespace-ignoring turn diff prints it as context.
const REINDENTED = 3

// Neighbouring lines open with keywords of different lengths, so a token one line off is visible.
function sourceLine(name: string, line: number) {
  const shapes = [
    `export const ${name}${line} = ${line}`,
    `let ${name}${line} = 'x'`,
    `function ${name}${line}() {}`,
    `const ${name}${line} = true`,
  ]
  return shapes[line % shapes.length]!
}

function fileText(name: string, edited: boolean, large = false) {
  const lines = Array.from({ length: 40 }, (_, index) => {
    const line = index + 1
    if (edited && EDITED.has(line)) return `let edited${line} = 'y'`
    if (edited && line === REINDENTED) return `    ${sourceLine(name, line)}`
    return sourceLine(name, line)
  })
  return `${lines.join('\n')}\n${large ? '// ' + 'padding'.repeat(160000) + '\n' : ''}`
}

async function prepareFixture(large: boolean) {
  const fixture = await createGitFixture('checkpoint-diff-tokens')
  await mkdir(join(fixture, 'src'), { recursive: true })
  for (const name of FILES)
    await writeFile(join(fixture, `src/${name}.ts`), fileText(name, false, large))
  await fixtureGit(fixture, ['add', '--all'])
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

type RowCheck = { readonly row: string; readonly covered: readonly string[] }

export const checkpointDiffTokens = checkpointScenario(false)
export const checkpointDiffSourceRefusal = checkpointScenario(true)

function checkpointScenario(partial: boolean) {
  return isolatedNativeScenario({
    name: partial ? 'checkpoint-diff-source-refusal' : 'checkpoint-diff-tokens',
    description: partial
      ? 'A captured checkpoint patch survives a Git blob refusal at the registered one-MiB limit. Both source blobs exceed one MiB; the patch stays visible and uncoloured.'
      : 'A two-file checkpoint draws only the selected source pair in stacked and split views under tree-sitter and Shiki. A 500-byte filesystem limit leaves Git comparisons complete under their registered Git limit.',
    fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
    prepareWorktree: () => prepareFixture(partial),
    async drive(page, { orchestration, root, step, worktreePath }) {
      await writeFile(
        join(root, 'checkpoint-control.json'),
        JSON.stringify({
          cwd: worktreePath,
          hold: false,
          turns: [
            FILES.map((name) => ({
              op: 'write',
              path: `src/${name}.ts`,
              text: fileText(name, true, partial),
            })),
          ],
        }),
      )
      await selectors.chatMessage(page).fill('Edit both files.')
      await selectors.chatSend(page).click()
      await selectors.chatMessages(page).getByText('CHECKPOINT_TURN_DONE').first().waitFor()
      const git = selectors.chatToolTab(page, 'Git')
      await git.waitFor({ timeout: 20_000 })
      if (!(await selectors.gitPanel(page).isVisible())) await git.click()
      await selectors.gitDiffScope(page, 'Turn').click()
      const second = selectors.turnFiles(page).getByRole('treeitem', { name: /second\.ts/ })
      await second.waitFor({ timeout: 15_000 })
      if (partial) {
        const base = orchestration.replace(/\/orchestration$/, '')
        await writeSettings(page, base, [{ kind: 'set', key: 'git.maxDiffFileSizeMiB', value: 1 }])
      }
      const blobResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith('/git/diff/blob') && response.status() === 200,
      )
      await second.click()
      const blob = await (await blobResponse).json()
      await selectors.diffRows(page).first().waitFor({ timeout: 15_000 })
      const notice = selectors.diffPartialNotice(page)
      if (partial) {
        await notice.waitFor({ timeout: 15_000 })
        await step('partial')
        await assertUncoloured(page)
        ok(
          Array.isArray(blob) &&
            blob.length === 1 &&
            blob[0].omitted === 'size' &&
            blob[0].oldText === undefined &&
            blob[0].newText === undefined,
          'The actual Git blob route refuses both complete sources at the registered limit',
        )
        return { caches: await page.evaluate(readCaches), address: page.url(), blob }
      }
      await waitForColouredRows(page)
      ok(!(await notice.isVisible()), 'The complete blob pair fell back to the partial patch')
      await step('second-file')
      await assertAligned(page)
      const base = orchestration.replace(/\/orchestration$/, '')
      await writeSettings(page, base, [
        { kind: 'set', key: 'editor.diff.viewMode', value: 'split' },
      ])
      await selectors.diffPanes(page).nth(1).waitFor({ timeout: 15_000 })
      await waitForColouredRows(page)
      await step('split-tree-sitter')
      await assertAligned(page)
      const lastStyle = await newestTokenStyle(page)
      await writeSettings(page, base, [
        { kind: 'set', key: 'editor.codeTheme.dark', value: 'github-dark' },
        { kind: 'set', key: 'editor.codeTheme.light', value: 'github-light' },
      ])
      // Shiki paints with its own palette, and each new colour registers a newer token style.
      await page.waitForFunction(
        ({ last, source }) => (new Function(`return (${source})`)() as () => number)() > last,
        { last: lastStyle, source: NEWEST_TOKEN_STYLE },
        { timeout: 15_000 },
      )
      await page.waitForTimeout(500)
      await waitForColouredRows(page)
      await step('split-shiki')
      await assertAligned(page)
      ok(
        Array.isArray(blob) &&
          blob.length === 1 &&
          typeof blob[0].oldText === 'string' &&
          typeof blob[0].newText === 'string',
        'The actual Git blob route supplies complete sources',
      )
      return { caches: await page.evaluate(readCaches), address: page.url(), blob }
    },
  })
}

async function waitForColouredRows(page: Page) {
  await page.waitForFunction(
    (source) => {
      const checks = (new Function(`return (${source})`)() as () => RowCheck[])()
      return checks.filter((check) => check.covered.length > 0).length > 4
    },
    ROW_CHECKS.replaceAll('PANE', diffPaneSelector),
    { timeout: 15_000 },
  )
}

async function assertAligned(page: Page) {
  const rows = await rowChecks(page)
  const misplaced = rows.filter((row) => !row.covered.includes(firstWord(row.row)))
  ok(rows.length > 4, `Expected coloured keyword rows, found ${rows.length}`)
  ok(
    rows.some((row) => row.row.includes('second')),
    'The diff shows the second file',
  )
  ok(
    rows.some((row) => row.row.startsWith('    ') && row.covered.length > 0),
    'The re-indented context line is coloured',
  )
  ok(misplaced.length === 0, `Rows coloured from another line: ${JSON.stringify(misplaced)}`)
}

/** Over the text limit the patch is all there is, so no row may carry a parsed token. */
async function assertUncoloured(page: Page) {
  await page.waitForTimeout(1_000)
  const rows = await rowChecks(page)
  const coloured = rows.filter((row) => row.covered.length > 0)
  ok(rows.length > 4, `Expected keyword rows, found ${rows.length}`)
  ok(coloured.length === 0, `A partial patch was parsed: ${JSON.stringify(coloured)}`)
}

function newestTokenStyle(page: Page): Promise<number> {
  return page.evaluate(
    (source) => (new Function(`return (${source})`)() as () => number)(),
    NEWEST_TOKEN_STYLE,
  )
}

// Page-side source: the highest shared token style id; a new colour always gets a higher one.
const NEWEST_TOKEN_STYLE = `() => Math.max(-1, ...[...CSS.highlights.keys()]
  .filter((name) => name.startsWith('${sharedTokenHighlightPrefix}'))
  .map((name) => Number(name.slice(${sharedTokenHighlightPrefix.length}))))`

function firstWord(row: string) {
  return /^\s*([A-Za-z]+)/.exec(row)?.[1] ?? ''
}

function rowChecks(page: Page): Promise<RowCheck[]> {
  return page.evaluate(
    (source) => (new Function(`return (${source})`)() as () => RowCheck[])(),
    ROW_CHECKS.replaceAll('PANE', diffPaneSelector),
  )
}

// Page-side source: every diff row that opens with a keyword, and the token texts that start
// exactly where that keyword starts. Highlight ranges are StaticRanges, which carry no text.
const ROW_CHECKS = `() => {
  const starts = new Map()
  for (const [name, highlight] of CSS.highlights.entries()) {
    if (!name.startsWith('${sharedTokenHighlightPrefix}')) continue
    for (const range of highlight) {
      const row = range.startContainer.parentElement?.closest('PANE ${editorRowSelector}')
      if (!row) continue
      const before = document.createRange()
      before.setStart(row, 0)
      before.setEnd(range.startContainer, range.startOffset)
      const list = starts.get(row) ?? []
      const token = document.createRange()
      token.setStart(range.startContainer, range.startOffset)
      token.setEnd(range.endContainer, range.endOffset)
      list.push({ offset: before.toString().length, text: token.toString() })
      starts.set(row, list)
    }
  }
  const checks = []
  for (const row of document.querySelectorAll('PANE ${editorRowSelector}')) {
    const text = row.textContent ?? ''
    const word = /^\\s*(export|let|function|const)\\b/.exec(text)
    if (!word) continue
    const at = text.indexOf(word[1])
    const covered = (starts.get(row) ?? []).filter((token) => token.offset === at).map((token) => token.text)
    checks.push({ row: text, covered })
  }
  return checks
}`
