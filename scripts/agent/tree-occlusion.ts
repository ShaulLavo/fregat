import type { Page } from 'playwright'

export async function inspectTreeOcclusion(page: Page) {
  return page.evaluate(`(() => {
    const host = document.querySelector('file-tree-container')
    const root = host?.shadowRoot
    const overlay = root?.querySelector('[data-file-tree-sticky-overlay-content]')
    const flow = root?.querySelector('[data-file-tree-virtualized-sticky]')
    const scroll = root?.querySelector('[data-file-tree-virtualized-scroll]')
    if (!root || !overlay || !flow || !scroll) return { mounted: false }
    const overlayBounds = overlay.getBoundingClientRect()
    const rows = Array.from(root.querySelectorAll('button[data-type="item"]'), (row) => ({
      path: row.getAttribute('data-item-path'),
      sticky: row.getAttribute('data-file-tree-sticky-row') === 'true',
      clipPath: getComputedStyle(row).clipPath,
      bounds: row.getBoundingClientRect().toJSON(),
    }))
    return {
      mounted: true,
      scrollTop: scroll.scrollTop,
      overlay: {
        bounds: overlayBounds.toJSON(),
        background: getComputedStyle(overlay).backgroundColor,
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
