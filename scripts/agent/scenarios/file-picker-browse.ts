import { ok } from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

// A 2×2 red PNG, so the image preview has real pixels to load.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

async function createTree() {
  const root = await mkdtemp('/work/tmp/fregat-picker-browse-')
  await mkdir(path.join(root, 'nested', 'deeper'), { recursive: true })
  await writeFile(
    path.join(root, 'app.ts'),
    'export function greet(name: string) {\n  return `hi ${name}`\n}\n',
  )
  await writeFile(path.join(root, 'pixel.png'), PNG)
  // Past the 64 KB preview budget, with a first line far wider than the preview.
  const lines = Array.from({ length: 4000 }, (_, index) => `export const line${index} = ${index}`)
  await writeFile(path.join(root, 'long.ts'), [`// ${'wide '.repeat(80)}`, ...lines].join('\n'))
  await writeFile(path.join(root, 'nested', 'inside.md'), '# Inside\n')
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

async function goTo(page: Page, folder: string) {
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(folder)
  await page.keyboard.press('Enter')
  await selectors.pickerRow(page, 'app.ts').waitFor()
}

export const filePickerBrowse: Scenario = {
  name: 'file-picker-browse',
  description:
    'Browse a fixture folder in the web picker: columns three deep with the keyboard, then in the list the code, image and folder previews, the item count and the ⌘[ ⌘] ⌘↓ chords, then the icons grid.',
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
      await selectors.pickerColumn(page, 1).getByText('inside.md', { exact: true }).waitFor()
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
      await selectors
        .pickerPreview(page)
        .locator('[data-file-preview-text]')
        .getByText('Inside')
        .waitFor()
      await step('columns-path')
      await page.keyboard.press('ArrowLeft')
      ok(
        await selectors
          .pickerColumn(page, 0)
          .evaluate((column) => column === document.activeElement),
        '← returns to the parent column',
      )
      await selectors.pickerView(page, 'List').click()
      await selectors.pickerList(page).waitFor()

      await selectors.pickerRow(page, 'app.ts').click()
      await selectors
        .pickerPreview(page)
        .locator('[data-file-preview-text]')
        .getByText('greet')
        .waitFor()
      await step('code-preview')

      await selectors.pickerRow(page, 'long.ts').click()
      await selectors.pickerPreviewNote(page).waitFor()
      ok(
        /^First 64 KB of \d/.test(await selectors.pickerPreviewNote(page).innerText()),
        'A file past the budget says how much the preview shows',
      )
      await selectors.pickerPreviewScroll(page).hover()
      await page.mouse.wheel(0, 200_000)
      await page.mouse.wheel(20_000, 0)
      // Wheel scrolling lands over a few frames; wait for it rather than read mid-flight.
      await page
        .waitForFunction(
          () => {
            const lines = document.querySelector('[data-file-preview-lines]')
            return lines !== null && lines.scrollLeft > 0
          },
          undefined,
          { timeout: 3000 },
        )
        .catch(() => undefined)
      const edges = await page.evaluate(() => {
        const vertical = document.querySelector('[data-file-preview-scroll]')
        const horizontal = document.querySelector('[data-file-preview-lines]')
        if (!vertical || !horizontal) return null
        return {
          bottom: vertical.scrollHeight - vertical.scrollTop - vertical.clientHeight,
          right: horizontal.scrollWidth - horizontal.scrollLeft - horizontal.clientWidth,
          wide: horizontal.scrollWidth > horizontal.clientWidth,
        }
      })
      ok(edges?.wide, 'The first line is wider than the preview')
      ok(edges.bottom <= 1, `The preview scrolls to its end (${edges.bottom}px left)`)
      ok(edges.right <= 1, `The preview scrolls to its right edge (${edges.right}px left)`)
      await step('long-preview-end')

      await selectors.pickerRow(page, 'pixel.png').click()
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-file-preview] img')
        return (
          image !== null &&
          image.complete &&
          image.naturalWidth > 0 &&
          getComputedStyle(image).opacity === '1'
        )
      })
      await step('image-preview')

      await selectors.pickerRow(page, 'nested').click()
      await selectors.pickerPreview(page).getByText('inside.md', { exact: true }).waitFor()
      await step('folder-preview')

      await page.keyboard.press('ControlOrMeta+ArrowDown')
      await selectors.pickerRow(page, 'inside.md').waitFor()
      await page.keyboard.press('ControlOrMeta+BracketLeft')
      await selectors.pickerRow(page, 'app.ts').waitFor()
      await page.keyboard.press('ControlOrMeta+BracketRight')
      await selectors.pickerRow(page, 'inside.md').waitFor()
      await step('history-chords')

      await page.keyboard.press('ControlOrMeta+BracketLeft')
      await selectors.pickerView(page, 'Icons').click()
      await selectors.pickerRow(page, 'pixel.png').waitFor()
      await page.waitForFunction(() =>
        [...document.querySelectorAll<HTMLImageElement>('[role="option"] img')].some(
          (image) =>
            image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1',
        ),
      )
      await selectors.pickerList(page).focus()
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowRight')
      ok(
        (await selectors.pickerList(page).getAttribute('aria-activedescendant'))?.endsWith(
          'app.ts',
        ),
        '→ moves one tile in the grid',
      )
      ok(
        (await selectors.pickerView(page, 'Icons').getAttribute('aria-selected')) === 'true',
        'The Icons tab is the pressed one',
      )
      // The indicator slides for --duration-enter; a screenshot inside that slide shows the old tab.
      await page.waitForFunction(() => {
        const list = document.querySelector('[role="tablist"][aria-label="View"]')
        const tab = list?.querySelector('[role="tab"][aria-selected="true"]')
        const indicator = list?.querySelector('[data-slot="tabs-indicator"]')
        if (!tab || !indicator) return false
        return Math.abs(tab.getBoundingClientRect().x - indicator.getBoundingClientRect().x) < 1
      })
      await step('icons-grid')
      await page.keyboard.press('Escape')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
}
