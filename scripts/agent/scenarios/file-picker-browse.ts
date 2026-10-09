import { scratchPath } from '../paths'
import { ok } from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

// The folder picker lists folders only; `app.ts` stays on disk so the listing has a file to hide.
async function createTree() {
  const root = await mkdtemp(scratchPath('fregat-picker-browse-'))
  await mkdir(path.join(root, 'alpha', 'one'), { recursive: true })
  await mkdir(path.join(root, 'nested', 'deeper'), { recursive: true })
  await mkdir(path.join(root, 'nested', 'inside', 'core'), { recursive: true })
  await writeFile(path.join(root, 'app.ts'), 'export const app = 1\n')
  return root
}

async function width(locator: Locator) {
  const box = await locator.boundingBox()
  ok(box, 'The element is on screen')
  return box.width
}

async function drag(page: Page, handle: Locator, dx: number) {
  const box = await handle.boundingBox()
  ok(box, 'The handle is on screen')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 4 })
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
}

function near(actual: number, expected: number, message: string) {
  ok(Math.abs(actual - expected) <= 2, `${message}: ${actual} is not ${expected}`)
}

// The indicator slides for --duration-enter; a screenshot inside that slide shows the old tab.
async function viewTabSettled(page: Page) {
  await page.waitForFunction(() => {
    const list = document.querySelector('[role="tablist"][aria-label="View"]')
    const tab = list?.querySelector('[role="tab"][aria-selected="true"]')
    const indicator = list?.querySelector('[data-slot="tabs-indicator"]')
    if (!tab || !indicator) return false
    return Math.abs(tab.getBoundingClientRect().x - indicator.getBoundingClientRect().x) < 1
  })
}

async function goTo(page: Page, folder: string) {
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(folder)
  await page.keyboard.press('Enter')
  await selectors.pickerRow(page, 'alpha').waitFor()
}

export const filePickerBrowse: Scenario = {
  name: 'file-picker-browse',
  description:
    'Browse a fixture folder in the web picker: columns three deep with the keyboard, then in the list the folder preview, the item count and the ⌘[ ⌘] ⌘↓ chords, then the icons grid.',
  async run(page, { step }) {
    const root = await createTree()
    try {
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await goTo(page, root)
      ok(
        /^\d+ items?$/.test(await selectors.pickerStatus(page).innerText()),
        'The footer counts the listing',
      )

      // Every pane and every column resizes; panes persist, column widths last the session.
      const column = await width(selectors.pickerColumnBox(page, 0))
      await drag(page, selectors.pickerColumnHandle(page, 0), 80)
      near(await width(selectors.pickerColumnBox(page, 0)), column + 80, 'The column drags wider')
      await selectors.pickerColumnHandle(page, 0).dblclick()
      ok(
        (await width(selectors.pickerColumnBox(page, 0))) < column,
        'Double-clicking the handle fits the column to its short names',
      )
      await drag(page, selectors.pickerColumnHandle(page, 0), 120)
      const places = await width(selectors.pickerPane(page, 0))
      const preview = await width(selectors.pickerPane(page, 2))
      await drag(page, selectors.pickerPaneHandle(page, 0), 60)
      await drag(page, selectors.pickerPaneHandle(page, 1), -80)
      const resized = {
        places: await width(selectors.pickerPane(page, 0)),
        preview: await width(selectors.pickerPane(page, 2)),
      }
      near(resized.places, places + 60, 'The places sidebar drags wider')
      near(resized.preview, preview + 80, 'The preview drags wider')
      await step('resized')
      await page.keyboard.press('Escape')
      await selectors.pickerDialog(page).waitFor({ state: 'hidden' })
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await goTo(page, root)
      near(await width(selectors.pickerPane(page, 0)), resized.places, 'Places keep their width')
      near(
        await width(selectors.pickerPane(page, 2)),
        resized.preview,
        'The preview keeps its width',
      )
      near(
        await width(selectors.pickerColumnBox(page, 0)),
        column,
        'A new session opens columns at the default',
      )
      await step('reopened')

      // Columns are the default when choosing a folder.
      await selectors.pickerRow(page, 'nested').click()
      await selectors.pickerColumn(page, 1).getByText('deeper', { exact: true }).waitFor()
      await page.keyboard.press('ArrowRight')
      await selectors.pickerColumn(page, 2).waitFor()
      await page.keyboard.press('ArrowRight')
      ok(
        await selectors
          .pickerColumn(page, 2)
          .evaluate((column) => column === document.activeElement),
        '→ enters an empty folder',
      )
      await page.keyboard.press('ArrowLeft')
      ok(
        await selectors
          .pickerColumn(page, 1)
          .evaluate((column) => column === document.activeElement),
        '← leaves an empty folder',
      )
      await step('empty-column-return')
      await page.keyboard.press('ArrowDown')
      await selectors.pickerPreview(page).getByText('core', { exact: true }).waitFor()
      await step('columns-path')
      await page.keyboard.press('ArrowLeft')
      ok(
        await selectors
          .pickerColumn(page, 0)
          .evaluate((column) => column === document.activeElement),
        '← returns to the parent column',
      )
      // A switch keeps the deepest selection: the list opens its folder with it selected.
      await selectors.pickerView(page, 'List').click()
      await selectors.pickerList(page).waitFor()
      await selectors
        .pickerRow(page, 'inside')
        .and(page.locator('[aria-selected="true"]'))
        .waitFor()
      await viewTabSettled(page)
      await step('list-keeps-selection')
      await page.keyboard.press('ControlOrMeta+ArrowUp')

      await selectors.pickerRow(page, 'nested').click()
      await selectors.pickerPreview(page).getByText('deeper', { exact: true }).waitFor()
      await step('folder-preview')

      await page.keyboard.press('ControlOrMeta+ArrowDown')
      await selectors.pickerRow(page, 'inside').waitFor()
      await page.keyboard.press('ControlOrMeta+BracketLeft')
      await selectors.pickerRow(page, 'alpha').waitFor()
      await page.keyboard.press('ControlOrMeta+BracketRight')
      await selectors.pickerRow(page, 'inside').waitFor()
      await step('history-chords')

      await page.keyboard.press('ControlOrMeta+BracketLeft')
      await selectors.pickerView(page, 'Icons').click()
      await selectors.pickerRow(page, 'alpha').waitFor()
      await selectors.pickerList(page).focus()
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowRight')
      ok(
        (await selectors.pickerList(page).getAttribute('aria-activedescendant'))?.endsWith(
          'nested',
        ),
        '→ moves one tile in the grid',
      )
      ok(
        (await selectors.pickerView(page, 'Icons').getAttribute('aria-selected')) === 'true',
        'The Icons tab is the pressed one',
      )
      await viewTabSettled(page)
      await step('icons-grid')
      await page.keyboard.press('Escape')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
}
