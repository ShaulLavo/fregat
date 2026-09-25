import { ok } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { diffPaneSelector, selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

const FILES = ['first', 'second'] as const
const EDITED = new Set([5, 30])

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

function fileText(name: string, edited: boolean) {
  const lines = Array.from({ length: 40 }, (_, index) => {
    const line = index + 1
    if (edited && EDITED.has(line)) return `let edited${line} = 'y'`
    return sourceLine(name, line)
  })
  return `${lines.join('\n')}\n`
}

async function prepareFixture() {
  const fixture = await createGitFixture('checkpoint-diff-tokens')
  await mkdir(join(fixture, 'src'), { recursive: true })
  for (const name of FILES) await writeFile(join(fixture, `src/${name}.ts`), fileText(name, false))
  await fixtureGit(fixture, ['add', '--all'])
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

type RowCheck = { readonly row: string; readonly covered: readonly string[] }

export const checkpointDiffTokens = isolatedNativeScenario({
  name: 'checkpoint-diff-tokens',
  description:
    'A turn edits lines 5 and 30 of two files; the checkpoint diff of the second file colours every row from its own source line from its complete blob pair. Run with FS_DEV_MAX_TEXT_FILE_BYTES=500 and the pair is over the text limit: the patch is drawn uncoloured under the partial notice.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: prepareFixture,
  async drive(page, { root, step, worktreePath }) {
    await writeFile(
      join(root, 'checkpoint-control.json'),
      JSON.stringify({
        cwd: worktreePath,
        hold: false,
        turns: [
          FILES.map((name) => ({
            op: 'write',
            path: `src/${name}.ts`,
            text: fileText(name, true),
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
    const second = selectors.turnFiles(page).getByRole('option', { name: /second\.ts/ })
    await second.waitFor({ timeout: 15_000 })
    await second.click()
    await selectors.diffRows(page).first().waitFor({ timeout: 15_000 })
    const partial = selectors.diffPartialNotice(page)
    // Whichever lands first decides the branch; the loser's timeout is not a failure.
    await Promise.race([
      partial.waitFor({ timeout: 15_000 }).catch(() => undefined),
      waitForColouredRows(page).catch(() => undefined),
    ])
    if (await partial.isVisible()) {
      await step('partial')
      await assertUncoloured(page)
      return
    }
    await step('second-file')
    await assertAligned(page)
  },
})

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
    if (!name.startsWith('editor-shared-token-')) continue
    for (const range of highlight) {
      const row = range.startContainer.parentElement?.closest('PANE [data-editor-virtual-row]')
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
  for (const row of document.querySelectorAll('PANE [data-editor-virtual-row]')) {
    const text = row.textContent ?? ''
    const word = /^\\s*(export|let|function|const)\\b/.exec(text)
    if (!word) continue
    const at = text.indexOf(word[1])
    const covered = (starts.get(row) ?? []).filter((token) => token.offset === at).map((token) => token.text)
    checks.push({ row: text, covered })
  }
  return checks
}`
