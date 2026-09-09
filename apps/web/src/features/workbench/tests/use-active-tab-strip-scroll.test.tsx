import { render } from '@testing-library/react'
import { StrictMode } from 'react'

import { useActiveTabStripScroll } from '@/features/workbench/hooks/use-active-tab-strip-scroll'
import { expect, test } from '../../../../test/fixtures'

function Strip({ activeTabId }: { activeTabId: string | null }) {
  const stripRef = useActiveTabStripScroll(activeTabId)

  return (
    <div ref={stripRef}>
      <button data-editor-tab-id='a' type='button' />
      <button data-editor-tab-id='b' type='button' />
    </div>
  )
}

/**
 * happy-dom reports every box as empty, so a tab is never off screen and nothing is ever revealed.
 * Giving the second tab a box past the strip's right edge is what puts the reveal on the path.
 */
function stubClippedSecondTab() {
  const original = Element.prototype.getBoundingClientRect
  const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 100,
  })
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    if (this instanceof HTMLElement && this.dataset.editorTabId === 'b') {
      return { left: 400, right: 500, width: 100 } as DOMRect
    }
    if (this instanceof HTMLElement && this.dataset.editorTabId === 'a') {
      return { left: 8, right: 92, width: 84 } as DOMRect
    }

    return { left: 0, right: 100, width: 100 } as DOMRect
  }

  return () => {
    Element.prototype.getBoundingClientRect = original
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
  }
}

function recordScrollTo() {
  const original = Element.prototype.scrollTo
  const calls: ScrollToOptions[] = []
  Element.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number) {
    if (typeof options === 'object') calls.push(options)
  } as Element['scrollTo']

  return {
    calls,
    restore: () => {
      Element.prototype.scrollTo = original
    },
  }
}

function stubReducedMotion(reduce: boolean) {
  const original = window.matchMedia
  window.matchMedia = ((query: string) =>
    ({ matches: reduce, media: query }) as MediaQueryList) as typeof window.matchMedia

  return () => {
    window.matchMedia = original
  }
}

test('revealing a tab scrolls to it instead of jumping', () => {
  const restoreRects = stubClippedSecondTab()
  const restoreMotion = stubReducedMotion(false)
  const scrolls = recordScrollTo()

  try {
    const { rerender } = render(<Strip activeTabId='a' />)
    expect(scrolls.calls).toHaveLength(0)
    rerender(<Strip activeTabId='b' />)

    expect(scrolls.calls).toHaveLength(1)
    expect(scrolls.calls[0]?.behavior).toBe('smooth')
    expect(scrolls.calls[0]?.left).toBeGreaterThan(0)
  } finally {
    scrolls.restore()
    restoreMotion()
    restoreRects()
  }
})

test('a tab that is already clipped on first mount is revealed immediately', () => {
  const restoreRects = stubClippedSecondTab()
  const restoreMotion = stubReducedMotion(false)
  const scrolls = recordScrollTo()

  try {
    render(<Strip activeTabId='b' />)

    expect(scrolls.calls).toHaveLength(1)
    expect(scrolls.calls[0]?.behavior).toBe('instant')
    expect(scrolls.calls[0]?.left).toBeGreaterThan(0)
  } finally {
    scrolls.restore()
    restoreMotion()
    restoreRects()
  }
})

test('a selection restored after the strip mounts is revealed immediately', () => {
  const restoreRects = stubClippedSecondTab()
  const restoreMotion = stubReducedMotion(false)
  const scrolls = recordScrollTo()

  try {
    const { rerender } = render(<Strip activeTabId={null} />)
    rerender(<Strip activeTabId='b' />)

    expect(scrolls.calls).toHaveLength(1)
    expect(scrolls.calls[0]?.behavior).toBe('instant')
  } finally {
    scrolls.restore()
    restoreMotion()
    restoreRects()
  }
})

test('strict mode replay keeps the initial reveal immediate', () => {
  const restoreRects = stubClippedSecondTab()
  const restoreMotion = stubReducedMotion(false)
  const scrolls = recordScrollTo()

  try {
    render(
      <StrictMode>
        <Strip activeTabId='b' />
      </StrictMode>,
    )

    expect(scrolls.calls.length).toBeGreaterThan(0)
    expect(scrolls.calls.every((call) => call.behavior === 'instant')).toBe(true)
  } finally {
    scrolls.restore()
    restoreMotion()
    restoreRects()
  }
})

test('someone who asked the OS for less motion gets none', () => {
  const restoreRects = stubClippedSecondTab()
  const restoreMotion = stubReducedMotion(true)
  const scrolls = recordScrollTo()

  try {
    const { rerender } = render(<Strip activeTabId='a' />)
    scrolls.calls.length = 0
    rerender(<Strip activeTabId='b' />)

    expect(scrolls.calls).toHaveLength(1)
    expect(scrolls.calls[0]?.behavior).toBe('auto')
  } finally {
    scrolls.restore()
    restoreMotion()
    restoreRects()
  }
})
