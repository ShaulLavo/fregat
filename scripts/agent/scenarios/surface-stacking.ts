import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

/**
 * Surface tokens are translucent, so painting one inside a region that already
 * paints it does not change the tone — it only doubles the alpha. Against the
 * wallpaper that reads as an extra layer; against a flat background it is
 * invisible. Either way the class is a bug, so this walks the real DOM and
 * reports every element whose painted background matches its nearest painted
 * ancestor.
 */
export const surfaceStacking: Scenario = {
  name: 'surface-stacking',
  description: 'Walk every main surface and report translucent backgrounds painted twice.',
  async run(page, { step }) {
    for (const tab of ['Files', 'Git', 'Search', 'Chat'] as const) {
      await selectors.sidebarTab(page, tab).click()
      await page.waitForTimeout(400)
      await step(`sidebar-${tab.toLowerCase()}`)
      await record(page, `sidebar:${tab}`)
    }

    await selectors.workspaceMode(page, 'Chat').click()
    await page.waitForTimeout(800)
    await step('chat-mode')
    await record(page, 'chat-mode')

    await selectors.workspaceMode(page, 'Workbench').click()
    await page.waitForTimeout(400)
  },
  async inspect() {
    return { findings }
  },
}

const findings: { readonly where: string; readonly stacked: readonly Stack[] }[] = []

type Stack = {
  readonly color: string
  readonly element: string
  readonly ancestor: string
  readonly box: string
}

async function record(page: Page, where: string) {
  const stacked = await page.evaluate(scan)
  findings.push({ where, stacked })
}

/** Runs in the page: no imports, no closure over anything above. */
function scan() {
  const painted: { node: Element; color: string; alpha: number }[] = []
  const out: { color: string; element: string; ancestor: string; box: string }[] = []

  function describe(node: Element) {
    const slot = node.getAttribute('data-slot')
    const label = node.getAttribute('aria-label')
    const cls = node.className
    const classes = typeof cls === 'string' ? cls.split(/\s+/).slice(0, 6).join(' ') : ''
    return [node.tagName.toLowerCase(), slot && `[${slot}]`, label && `"${label}"`, classes]
      .filter(Boolean)
      .join(' ')
  }

  // Tokens compute as `oklch(L C H / A)`; only fully absent paint is rgba(0,0,0,0).
  function alphaOf(color: string) {
    if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return 0
    const slash = color.match(/\/\s*([0-9.]+)\s*\)/)
    if (slash) return Number.parseFloat(slash[1])
    const rgba = color.match(/rgba\(([^)]+)\)/)
    if (!rgba) return 1
    const parts = rgba[1].split(',').map((part) => Number.parseFloat(part))
    return parts.length < 4 ? 1 : parts[3]
  }

  function visit(node: Element, stack: { node: Element; color: string; alpha: number }[]) {
    const color = getComputedStyle(node).backgroundColor
    const alpha = alphaOf(color)
    let next = stack
    if (alpha > 0) {
      // Same color and both translucent: the second paint only thickens the first.
      const twin = alpha < 1 ? stack.findLast((entry) => entry.color === color) : undefined
      if (twin) {
        const box = node.getBoundingClientRect()
        out.push({
          color,
          element: describe(node),
          ancestor: describe(twin.node),
          box: `${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.x)},${Math.round(box.y)}`,
        })
      }
      next = [...stack, { node, color, alpha }]
    }
    for (const child of Array.from(node.children)) visit(child, next)
  }

  visit(document.body, painted)
  return out
}
