import { ok, strictEqual } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import {
  diffPaneSelector,
  openFileFromTree,
  openGitPanel,
  selectors,
  settleAnimations,
  textPoint,
} from '../selectors'
import { serverApi } from '../server-api'
import { heldRequests } from '../tree-parity/states'
import type { Scenario } from './index'

const inspections = new WeakMap<
  Page,
  { matchingPoint?: { x: number; y: number }; requests: number }
>()

export const reactiveOwnerSnapshots: Scenario = {
  name: 'reactive-owner-snapshots',
  requiresIsolatedServer: true,
  description:
    'Restore a recent folder, confirm saved tree actions, and refuse diff hover after an unsaved edit.',
  inspect: async (page) => inspections.get(page),
  async run(page, { step }) {
    const fixture = await createGitFixture('reactive-owners')
    const diskPath = path.join(fixture, 'a.ts')
    const text = 'export const diffOwner = 2\nexport const secondOwner = diffOwner\n'
    try {
      await writeFile(diskPath, text.replace('= 2', '= 1'))
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await writeFile(diskPath, text)
      await openFixtureWorkspace(page, fixture)
      const explicitAddress = page.url()
      await openFileFromTree(page, 'a.ts')
      await confirmSavedRows(page, fixture, step)
      await restoreRecentFolder(page, fixture, explicitAddress, step)
      await refuseDriftedHover(page, diskPath.slice(1), step)
      strictEqual(await readFile(diskPath, 'utf8'), text)
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function confirmSavedRows(
  page: Page,
  fixture: string,
  step: (name: string) => Promise<void>,
) {
  const held = heldRequests(page)
  await held.hold('/fs/tree', fixture.slice(1))
  try {
    await page.reload()
    await selectors.treeItem(page, 'a.ts').waitFor()
    await selectors.treeItem(page, 'a.ts').click({ button: 'right' })
    for (const item of treeMutationItems(page)) {
      strictEqual(await item.isEnabled(), false)
    }
    await step('saved-rows-await-confirmation')
    await page.keyboard.press('Escape')
    await held.release()
    await selectors.treeNewFileButton(page).waitFor({ state: 'visible' })
    await page.waitForFunction(
      (node) => node?.getAttribute('disabled') === null,
      await selectors.treeNewFileButton(page).elementHandle(),
    )
    await selectors.treeItem(page, 'a.ts').click({ button: 'right' })
    for (const item of treeMutationItems(page)) {
      strictEqual(await item.isEnabled(), true)
    }
    await step('confirmed-rows-enable-actions')
    await page.keyboard.press('Escape')
  } finally {
    await held.release()
  }
}

function treeMutationItems(page: Page) {
  return [
    selectors.menuItem(page, 'New File'),
    selectors.treeRenameMenuItem(page),
    selectors.menuItem(page, 'Delete'),
  ]
}

async function restoreRecentFolder(
  page: Page,
  fixture: string,
  explicitAddress: string,
  step: (name: string) => Promise<void>,
) {
  const { base, headers } = serverApi(page)
  const recorded = await page.request.post(`${base}/fs/recents`, {
    data: { path: fixture.slice(1) },
    headers,
  })
  ok(recorded.ok())
  await page.evaluate(() => localStorage.clear())
  await page.goto(new URL('/', page.url()).href)
  await selectors.treeItem(page, 'a.ts').waitFor()
  ok(page.url().includes('/~'))
  await step('root-address-restores-recent-folder')
  const otherRecent = await createGitFixture('reactive-other-recent')
  try {
    const otherRecorded = await page.request.post(`${base}/fs/recents`, {
      data: { path: otherRecent.slice(1) },
      headers,
    })
    ok(otherRecorded.ok())
    await page.goto(explicitAddress)
    await selectors.treeItem(page, 'a.ts').waitFor()
    await step('explicit-workspace-wins-over-other-recent-folder')
  } finally {
    await releaseFixture(otherRecent)
  }
}

async function refuseDriftedHover(
  page: Page,
  documentPath: string,
  step: (name: string) => Promise<void>,
) {
  const observation = { matchingPoint: { x: 0, y: 0 }, requests: 0 }
  inspections.set(page, observation)
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      const frame: unknown = JSON.parse(payload.toString())
      if (
        frame &&
        typeof frame === 'object' &&
        'method' in frame &&
        frame.method === 'textDocument/hover'
      )
        observation.requests += 1
    }),
  )
  await openFileFromTree(page, 'a.ts')
  await selectors.editorGroupTabs(page, 0).filter({ hasText: 'a.ts' }).click({ button: 'right' })
  await selectors.menuItem(page, 'Split Right').click()
  await selectors.editorGroups(page).nth(1).waitFor()
  await selectors.editorGroupContent(page, 0).click()
  await openGitPanel(page)
  await selectors.worktreeFiles(page).filter({ hasText: 'a.ts' }).first().click()
  await page.waitForFunction(languageMatchesReady, documentPath)
  await settleAnimations(selectors.diffPanes(page).first())
  const matchingPoint = await textPoint(
    page,
    'export const diffOwner = 2',
    'diffOwner',
    diffPaneSelector,
  )
  observation.matchingPoint = matchingPoint
  await page.mouse.move(matchingPoint.x, matchingPoint.y)
  await selectors.editorHover(page).waitFor({ state: 'visible', timeout: 8000 })
  ok(observation.requests > 0, 'matching working-tree text permits a real hover request')
  await step('matching-diff-hover')
  await selectors.editorGroupViewport(page, 1).click()
  await selectors.editorGroupInput(page, 1).focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('// unsaved\n')
  await selectors.editorGroupRows(page, 1).filter({ hasText: '// unsaved' }).waitFor()
  const before = observation.requests
  const point = await textPoint(
    page,
    'secondOwner',
    'secondOwner',
    `${diffPaneSelector}:last-of-type`,
  )
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(1200)
  strictEqual(
    observation.requests,
    before,
    'drifted diff sends no hover at the old document position',
  )
  strictEqual(await selectors.editorHover(page).count(), 0)
  await step('unsaved-same-buffer-edit-refuses-diff-hover')
}

function languageMatchesReady(documentPath: string) {
  type CacheClient = {
    getQueryCache(): {
      getAll(): { queryKey: readonly unknown[]; state: { status: string; data: unknown } }[]
    }
  }
  const registry: typeof globalThis & { __fregatQueryClients?: Map<string, CacheClient> } =
    globalThis
  return Array.from(registry.__fregatQueryClients?.values() ?? []).some((client) =>
    client
      .getQueryCache()
      .getAll()
      .some(
        (query) =>
          query.queryKey[0] === 'language-server-matches' &&
          query.queryKey[2] === documentPath &&
          query.state.status === 'success' &&
          Array.isArray(query.state.data) &&
          query.state.data.length > 0,
      ),
  )
}
