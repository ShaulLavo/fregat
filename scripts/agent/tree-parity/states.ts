import type { Locator, Page, Route } from 'playwright'
import { selectors } from '../selectors'
import { LONG_FILE_NAME } from './fixture'

/** Where the harness reaches the tree; a rebuilt tree keeps these roles and the label. */
export function treeRow(page: Page, path: string): Locator {
  return selectors.folderTree(page).locator(`[role="treeitem"][data-item-path="${path}"]`).first()
}

export function filterInput(page: Page): Locator {
  return selectors.folderTree(page).getByRole('textbox').first()
}

export type HeldRequests = {
  /** Holds every GET whose `path` query ends with `suffix` until `fail` or `release`. */
  hold(route: '/fs/tree' | '/fs/read', suffix: string): Promise<void>
  /** Answers held and later matching requests with a 500, retries included, until `release`. */
  fail(): Promise<void>
  /** Lets held requests through and stops matching. */
  release(): Promise<void>
}

export function heldRequests(page: Page): HeldRequests {
  let held: Route[] = []
  let failing = false
  let pattern: RegExp | null = null
  let handler: ((route: Route) => void) | null = null
  const answer = (route: Route) =>
    // A request the page aborted while held is already handled; there is nothing to answer.
    (failing
      ? route.fulfill({ status: 500, body: 'failed by the parity harness' })
      : route.fallback()
    ).catch(() => undefined)
  return {
    async hold(route, suffix) {
      failing = false
      pattern = new RegExp(`${route.replace('/', '\\/')}\\?`)
      handler = (intercepted) => {
        const url = new URL(intercepted.request().url())
        const path = url.searchParams.get('path') ?? ''
        if (!path.endsWith(suffix)) return void intercepted.fallback()
        if (failing) return void answer(intercepted)
        held.push(intercepted)
      }
      await page.route(pattern, handler)
    },
    async fail() {
      failing = true
      const routes = held
      held = []
      for (const route of routes) await answer(route)
    },
    async release() {
      failing = false
      const routes = held
      held = []
      for (const route of routes) await answer(route)
      if (pattern && handler) await page.unroute(pattern, handler)
      pattern = null
      handler = null
    },
  }
}

export type StateContext = {
  readonly page: Page
  readonly held: HeldRequests
  /** Puts the tree back to its rest state: filter closed, `src/app.ts` selected, focus outside. */
  readonly rest: () => Promise<void>
}

export type ParityState = {
  readonly name: string
  /** Mismatched-pixel ratio this state tolerates; animation-free states tolerate none. */
  readonly maxRatio?: number
  readonly enter: (context: StateContext) => Promise<void>
  readonly leave?: (context: StateContext) => Promise<void>
}

async function clickRow(page: Page, path: string, options: Parameters<Locator['click']>[0] = {}) {
  await treeRow(page, path).click(options)
}

async function pointerAway(page: Page) {
  const viewport = page.viewportSize()
  await page.mouse.move((viewport?.width ?? 1440) - 20, (viewport?.height ?? 1000) / 2)
}

async function scroller(page: Page) {
  return selectors.folderTree(page).locator('[data-file-tree-virtualized-scroll]').first()
}

export const PARITY_STATES: readonly ParityState[] = [
  { name: 'rest', async enter() {} },
  {
    name: 'hover',
    async enter({ page }) {
      await treeRow(page, 'src/components/button.tsx').hover()
    },
  },
  {
    name: 'focus-keyboard',
    async enter({ page }) {
      await page.keyboard.press('ControlOrMeta+Shift+E')
      await treeRow(page, 'src/app.ts').waitFor()
      await page.keyboard.press('ArrowDown')
      await pointerAway(page)
    },
  },
  {
    name: 'focus-click',
    async enter({ page }) {
      await clickRow(page, 'src/styles.css')
      await pointerAway(page)
    },
  },
  {
    name: 'multi-select',
    async enter({ page }) {
      await clickRow(page, 'src/app.ts')
      await page.keyboard.press('Shift+ArrowDown')
      await page.keyboard.press('Shift+ArrowDown')
      await pointerAway(page)
    },
  },
  {
    name: 'menu-open',
    async enter({ page }) {
      await clickRow(page, 'src/styles.css', { button: 'right' })
      await page.getByRole('menu').first().waitFor()
      await pointerAway(page)
    },
    async leave({ page }) {
      await page.keyboard.press('Escape')
      await page.getByRole('menu').first().waitFor({ state: 'hidden' })
    },
  },
  {
    name: 'rename',
    async enter({ page }) {
      await clickRow(page, 'renamed.ts')
      await page.keyboard.press('F2')
      await selectors
        .folderTree(page)
        .locator('[role="treeitem"] input, [data-item-rename-input]')
        .first()
        .waitFor()
      await pointerAway(page)
    },
    async leave({ page }) {
      await page.keyboard.press('Escape')
    },
  },
  {
    name: 'drag-over-folder',
    // The drag clone follows the pointer and composites against the row under it.
    maxRatio: 0.002,
    async enter({ page }) {
      const source = await treeRow(page, 'untracked.py').boundingBox()
      const target = await treeRow(page, 'src/components/').boundingBox()
      if (!source || !target) throw new Error('drag rows are not on screen')
      await page.mouse.move(source.x + 40, source.y + source.height / 2)
      await page.mouse.down()
      await page.mouse.move(source.x + 60, source.y + source.height / 2 + 5, { steps: 4 })
      await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 8 })
    },
    async leave({ page }) {
      const source = await treeRow(page, 'untracked.py').boundingBox()
      if (source) await page.mouse.move(source.x + 40, source.y + source.height / 2, { steps: 8 })
      await page.mouse.up()
    },
  },
  {
    name: 'filter-match',
    async enter({ page }) {
      await filterInput(page).click()
      await page.keyboard.type('leaf')
      await pointerAway(page)
    },
  },
  {
    name: 'filter-empty',
    async enter({ page }) {
      await filterInput(page).click()
      await page.keyboard.type('zzzz-nothing')
      await pointerAway(page)
    },
  },
  {
    name: 'long-name-hover',
    async enter({ page }) {
      await treeRow(page, `src/${LONG_FILE_NAME}`).hover()
    },
  },
  {
    name: 'loading-file',
    async enter({ page, held }) {
      await held.hold('/fs/read', '/package.json')
      await clickRow(page, 'package.json')
      await pointerAway(page)
    },
    async leave({ held }) {
      await held.release()
    },
  },
  {
    name: 'loading-folder',
    async enter({ page, held }) {
      await held.hold('/fs/tree', '/pending')
      await clickRow(page, 'pending/')
      await pointerAway(page)
    },
    async leave({ held }) {
      await held.fail()
    },
  },
  {
    name: 'folder-error',
    async enter({ page }) {
      await selectors
        .folderTree(page)
        .locator('[role="treeitem"][data-item-path="pending/"]')
        .getByText('error')
        .waitFor()
      await pointerAway(page)
    },
    async leave({ page, held }) {
      await held.release()
      // Collapsing and expanding an errored folder retries it; the retry succeeds now.
      await clickRow(page, 'pending/')
      await clickRow(page, 'pending/')
      await treeRow(page, 'pending/inside.ts').waitFor()
      await clickRow(page, 'pending/')
    },
  },
  {
    name: 'sticky',
    async enter({ page }) {
      await clickRow(page, 'src/list/')
      await treeRow(page, 'src/list/item-00.ts').waitFor()
      await (await scroller(page)).hover()
      await page.mouse.wheel(0, 360)
      await page.waitForTimeout(400)
      await pointerAway(page)
    },
    async leave({ page }) {
      await (
        await scroller(page)
      ).evaluate((element) => {
        element.scrollTop = 0
      })
      await clickRow(page, 'src/list/')
    },
  },
]
