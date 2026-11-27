import type { Page } from 'playwright'

export async function inspectTreeOcclusion(page: Page) {
  return page.evaluate(`(() => {
    const root = document.querySelector('[data-file-tree]')
    const overlay = root?.querySelector('.wb-tree-sticky-overlay')
    const flow = root?.querySelector('.wb-tree-canvas')
    const scroll = root?.querySelector('[data-wb-tree-scroller]')
    if (!root || !flow || !scroll) return { mounted: false }
    const overlayBounds = overlay?.getBoundingClientRect() ?? scroll.getBoundingClientRect()
    const rows = Array.from(root.querySelectorAll('[data-wb-tree-row]'), (row) => ({
      path: row.getAttribute('data-path'),
      sticky: row.hasAttribute('data-wb-sticky-ancestor'),
      clipPath: getComputedStyle(row).clipPath,
      bounds: row.getBoundingClientRect().toJSON(),
    }))
    return {
      mounted: true,
      scrollTop: scroll.scrollTop,
      overlay: {
        bounds: overlayBounds.toJSON(),
        background: overlay ? getComputedStyle(overlay).backgroundColor : 'transparent',
      },
      flow: {
        bounds: flow.getBoundingClientRect().toJSON(),
        clipPath: getComputedStyle(flow).clipPath,
      },
      rows: rows.filter(
        (row) =>
          row.bounds.bottom >= overlayBounds.top && row.bounds.top < overlayBounds.bottom + 60,
      ),
    }
  })()`)
}
