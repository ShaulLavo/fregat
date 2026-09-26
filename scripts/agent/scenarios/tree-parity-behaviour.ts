import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page, Request } from 'playwright'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { selectors, waitForApp } from '../selectors'
import { filterInput, heldRequests, treeRow } from '../tree-parity/states'
import type { Scenario } from './index'

/**
 * The tree behaviours only the app can show (Plan 178 parity spec, the ✗ rows the package tests
 * cannot reach): Mod+F, folder hover prefetch, focus after delete, reload restore, and a create
 * deferred until its folder loads. Each asserts what today's tree does.
 */
export const treeParityBehaviour: Scenario = {
  name: 'tree-parity-behaviour',
  description:
    'Pin the file tree behaviours that need the app: Mod+F, folder hover prefetch, focus after delete, reload restore, deferred create.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-tree-behaviour-')
    try {
      await files(fixture, {
        'docs/guide.md': '# Guide\n',
        'later/inside.ts': 'export {}\n',
        'src/deep/doomed.ts': 'export {}\n',
        'src/deep/kept.ts': 'export {}\n',
        'src/app.ts': 'export {}\n',
        ...Object.fromEntries(
          Array.from({ length: 40 }, (_, index) => [`src/list/item-${index}.ts`, 'export {}\n']),
        ),
      })
      await openFixtureWorkspace(page, fixture)
      await treeRow(page, 'src/').waitFor()

      await modFOpensFilter(page)
      await step('mod-f')
      await folderHoverPrefetch(page)
      await step('folder-hover')
      await focusAfterDelete(page)
      await step('after-delete')
      await deferredCreate(page)
      await step('deferred-create')
      await reloadRestores(page)
      await step('reload-restored')
      await composerRowDrop(page)
      await step('composer-row-drop')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function files(root: string, entries: Record<string, string>) {
  for (const [name, content] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), content)
  }
}

async function modFOpensFilter(page: Page) {
  await treeRow(page, 'src/').click()
  await treeRow(page, 'src/').click()
  await page.keyboard.press('ControlOrMeta+F')
  await page.waitForFunction(
    () => {
      const host = document.querySelector<HTMLElement>('[aria-label="Folder tree"]')
      const active = host?.shadowRoot?.activeElement ?? document.activeElement
      return active?.matches('input') === true
    },
    undefined,
    { timeout: 3000 },
  )
  await page.keyboard.press('Escape')
  strictEqual(await filterInput(page).inputValue(), '')
}

/** Hovering a collapsed folder lists it ahead of the click. */
async function folderHoverPrefetch(page: Page) {
  const listed: string[] = []
  const record = (request: Request) => {
    if (!request.url().includes('/fs/tree?')) return
    listed.push(new URL(request.url()).searchParams.get('path') ?? '')
  }
  page.on('request', record)
  try {
    const box = await treeRow(page, 'docs/').boundingBox()
    ok(box, 'docs/ must be on screen')
    await page.mouse.move(box.x + box.width + 200, box.y + 200)
    await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 25 })
    await page.waitForTimeout(1000)
  } finally {
    page.off('request', record)
  }
  ok(
    listed.some((listedPath) => listedPath.endsWith('/docs')),
    `Hovering docs/ listed ${JSON.stringify(listed)}`,
  )
  strictEqual(await treeRow(page, 'docs/').getAttribute('aria-expanded'), 'false')
}

/** A deleted row hands focus to its nearest visible ancestor. */
async function focusAfterDelete(page: Page) {
  if ((await treeRow(page, 'src/').getAttribute('aria-expanded')) !== 'true')
    await treeRow(page, 'src/').click()
  await treeRow(page, 'src/deep/').click()
  await treeRow(page, 'src/deep/doomed.ts').click({ button: 'right' })
  await selectors.menuItem(page, 'Delete').click({ timeout: 5000 })
  await selectors.confirmTreeDelete(page).click({ timeout: 5000 })
  await treeRow(page, 'src/deep/doomed.ts').waitFor({ state: 'detached' })
  await page.waitForFunction(
    () => {
      const host = document.querySelector<HTMLElement>('[aria-label="Folder tree"]')
      const focused = (host?.shadowRoot ?? host)?.querySelector('[role="treeitem"][tabindex="0"]')
      return focused?.getAttribute('data-item-path') === 'src/deep/'
    },
    undefined,
    { timeout: 3000 },
  )
}

/** "New File" on a folder still loading plants its placeholder once the listing lands. */
async function deferredCreate(page: Page) {
  const held = heldRequests(page)
  await held.hold('/fs/tree', '/later')
  try {
    await treeRow(page, 'later/').click({ button: 'right' })
    await selectors.menuItem(page, 'New File').click({ timeout: 5000 })
    await page.waitForTimeout(300)
    const renameInputs = selectors
      .folderTree(page)
      .locator('input:not([data-file-tree-search-input])')
    strictEqual(await renameInputs.count(), 0, 'No placeholder before the folder loads')
    await held.release()
    await renameInputs.first().waitFor({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await renameInputs.first().waitFor({ state: 'detached' })
  } finally {
    await held.release()
  }
}

/** A reload restores expansion, selection and scroll when the active file is the same. */
async function reloadRestores(page: Page) {
  await treeRow(page, 'src/list/').click()
  await treeRow(page, 'src/list/item-0.ts').waitFor()
  await treeRow(page, 'src/app.ts').click()
  await selectors.editorInput(page).first().waitFor()
  const scroller = selectors.folderTree(page).locator('[data-file-tree-virtualized-scroll]').first()
  await scroller.hover()
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(500)
  const before = await treeSnapshot(page)
  await page.reload()
  await waitForApp(page)
  await treeRow(page, 'src/app.ts').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1000)
  deepStrictEqual(await treeSnapshot(page), before)
}

async function treeSnapshot(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[aria-label="Folder tree"]')
    const scope = host?.shadowRoot ?? host
    const rows = [...(scope?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])]
    return {
      expanded: rows
        .filter((row) => row.getAttribute('aria-expanded') === 'true')
        .map((row) => row.dataset.itemPath)
        .toSorted(),
      selected: rows
        .filter((row) => row.getAttribute('aria-selected') === 'true')
        .map((row) => row.dataset.itemPath),
      scrollTop: Math.round(
        scope?.querySelector('[data-file-tree-virtualized-scroll]')?.scrollTop ?? -1,
      ),
    }
  })
}

/**
 * A real row drag onto the chat composer. Today the tree sends a root-relative path and the
 * composer wants an absolute one (parity spec quirk 8), so no mention chip lands; the
 * drag-and-drop sub-plan fixes it and flips this check.
 */
async function composerRowDrop(page: Page) {
  await selectors.workspaceMode(page, 'Chat').click()
  const composer = selectors.chatMessage(page)
  await composer.waitFor({ timeout: 15_000 })
  const files = page
    .getByRole('tab', { name: 'Files', exact: true })
    .or(page.getByRole('button', { name: 'Files', exact: true }))
  await files.first().click()
  const source = await treeRow(page, 'src/list/item-5.ts').boundingBox()
  const target = await composer.boundingBox()
  ok(source && target, 'The row and the composer must both be on screen')
  await page.mouse.move(source.x + 30, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + 50, source.y + source.height / 2 + 6, { steps: 4 })
  strictEqual(
    await treeRow(page, 'src/list/item-5.ts').getAttribute('data-item-dragging'),
    'true',
    'The row drag must start',
  )
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const landed = await composer.evaluate((element) => ({
    text: element.textContent ?? '',
    mentions: element.querySelectorAll('[data-mention], [data-lexical-decorator]').length,
  }))
  strictEqual(landed.mentions, 0, `No mention chip lands today: ${JSON.stringify(landed)}`)
}
