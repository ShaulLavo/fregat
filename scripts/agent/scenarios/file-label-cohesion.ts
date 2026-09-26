import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'

import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

const DEEP_DIRECTORY = `needle-dir/${'nested/'.repeat(12)}`

/** Committed before the session starts; the checkpoint turn edits them. */
const COMMITTED: Record<string, string> = {
  'a.txt': 'one\n',
  [`${DEEP_DIRECTORY}content.ts`]: 'export const needle = 3\n',
  'src/removed.ts': 'export const removed = 4\n',
  'src/moved-from.ts': 'export const moved = 5\nexport const kept = 6\nexport const also = 7\n',
}

const TURN_EDITS = [
  { op: 'write', path: 'a.txt', text: 'one\ntwo\n' },
  { op: 'write', path: 'src/added.ts', text: 'export const added = 8\n' },
  { op: 'delete', path: 'src/removed.ts' },
  { op: 'rename', path: 'src/moved-from.ts', to: 'src/moved-to.ts' },
]

const EXPECTED_STATUS: Record<string, string> = {
  'a.txt': 'M',
  'added.ts': 'A',
  'moved-to.ts': 'R',
  'removed.ts': 'D',
}

async function prepareFixture() {
  const fixture = await createGitFixture('file-label-cohesion')
  for (const [path, text] of Object.entries(COMMITTED)) {
    await mkdir(join(fixture, path, '..'), { recursive: true })
    await writeFile(join(fixture, path), text)
  }
  await fixtureGit(fixture, ['add', '--all'])
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

/** Row text without the leading icon, which some file types draw as a private-use font glyph. */
async function rowTexts(rows: Locator) {
  return (await rows.allTextContents()).map((text) => text.replace(/^[\uE000-\uF8FF\s]+/u, ''))
}

/** Each row's trailing status letter, keyed by the file name it shows first. */
async function statusByName(rows: Locator) {
  const texts = await rowTexts(rows)
  const byName: Record<string, string> = {}
  for (const text of texts) {
    const name = Object.keys(EXPECTED_STATUS).find((candidate) => text.startsWith(candidate))
    if (name) byName[name] = text.trim().at(-1) ?? ''
  }
  return byName
}

async function checkpointRows(page: Page, step: (name: string) => Promise<void>) {
  await selectors.chatMessage(page).fill('Apply the fixture edits.')
  await selectors.chatSend(page).click()
  const tree = selectors.changedFilesTree(page).last()
  await tree.waitFor({ timeout: 30_000 })
  await tree.getByRole('treeitem', { name: /added\.ts/ }).waitFor({ timeout: 15_000 })
  await step('timeline-checkpoint-rows')
  const timeline = await statusByName(tree.getByRole('treeitem'))

  const git = selectors.chatToolTab(page, 'Git')
  await git.waitFor({ timeout: 20_000 })
  if (!(await selectors.gitPanel(page).isVisible())) await git.click()
  await selectors.gitDiffScope(page, 'Turn').click()
  const turnRows = selectors.turnFiles(page).getByRole('treeitem')
  await turnRows.first().waitFor({ timeout: 15_000 })
  await step('turn-panel-rows')
  const panel = await statusByName(turnRows)
  for (const [name, status] of Object.entries(EXPECTED_STATUS)) {
    strictEqual(timeline[name], status, `Timeline marks ${name} ${status}`)
    strictEqual(panel[name], status, `Turn panel marks ${name} ${status}`)
  }
}

async function searchRows(page: Page, worktreePath: string, step: (name: string) => Promise<void>) {
  await openFixtureWorkspace(page, worktreePath)
  await selectors.sidebarTab(page, 'Search').click()
  await selectors.workspaceSearch(page).fill('needle')
  const tree = selectors.searchResultTree(page)
  await tree.getByRole('treeitem', { name: /content\.ts/ }).waitFor({ timeout: 20_000 })
  await step('search-sidebar-rows')
  const group = tree.getByRole('treeitem').filter({ hasText: 'content.ts' })
  // Workspace Search sends includeNames: false, so a content group is the live file row here.
  ok(
    (await rowTexts(group)).every((text) => text.startsWith('content.ts')),
    'A match deep in the directory still shows its basename first',
  )
  ok(
    (await group.getAttribute('title'))?.endsWith(`${DEEP_DIRECTORY}content.ts`),
    'The full path is recoverable from the row title',
  )

  await selectors.openSearchEditor(page).click()
  const headers = selectors.searchEditor(page).getByRole('treeitem', { level: 1 })
  await headers.first().waitFor({ timeout: 20_000 })
  await step('search-editor-headers')
  const headerTexts = await rowTexts(headers)
  ok(
    headerTexts.some((text) => text.startsWith('content.ts')),
    'Search editor header: basename',
  )
}

async function gitRows(page: Page, step: (name: string) => Promise<void>) {
  await selectors.sidebarTab(page, 'Git').click()
  await selectors.worktreeFiles(page).first().waitFor({ timeout: 20_000 })
  await step('git-rows')
  const texts = await rowTexts(selectors.worktreeFiles(page))
  ok(
    texts.some((text) => text.startsWith('a.txt')),
    'Git rows show the basename first',
  )
  ok(
    texts.some((text) => text.startsWith('added.ts')),
    'Git lists the added file',
  )
}

export const fileLabelCohesion = isolatedNativeScenario({
  name: 'file-label-cohesion',
  description:
    'One disposable repository: a native checkpoint turn marks A/D/R/M the same in the timeline and the Turn panel, then Search (sidebar and editor) and Git rows show the basename before a deep directory.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: prepareFixture,
  async drive(page, { root, step, worktreePath }) {
    await writeFile(
      join(root, 'checkpoint-control.json'),
      JSON.stringify({ cwd: worktreePath, hold: false, turns: [TURN_EDITS] }),
    )
    await checkpointRows(page, step)
    await searchRows(page, worktreePath, step)
    await gitRows(page, step)
  },
})
