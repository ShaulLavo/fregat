import { describe, expect, it, vi } from 'vitest'
import { colorAlpha, readColorAlpha } from '../src/colorAlpha'

describe('registered diagnostic opacity color', () => {
  it.each([
    ['#000a', 170 / 255],
    ['#0007', 119 / 255],
    ['#ffcc0010', 16 / 255],
    ['rgba(10, 20, 30, 0.25)', 0.25],
    ['rgb(10 20 30 / 40%)', 0.4],
    ['color(srgb 0.1 0.2 0.3 / 0.75)', 0.75],
    ['oklch(50% 0.2 30 / 0)', 0],
    ['rgb(10, 20, 30)', 1],
    ['transparent', 0],
  ])('reads the alpha from %s', (color, alpha) => expect(colorAlpha(color)).toBe(alpha))

  it('resolves the theme variable on its owning editor and releases its probe', () => {
    const host = document.createElement('div')
    const getStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      expect(element.parentElement).toBe(host)
      expect((element as HTMLElement).style.color).toBe('var(--editor-test-opacity)')
      return { color: 'rgba(0, 0, 0, 0.3)' } as CSSStyleDeclaration
    })
    try {
      expect(readColorAlpha(host, 'var(--editor-test-opacity)')).toBe(0.3)
      expect(host.childElementCount).toBe(0)
    } finally {
      getStyle.mockRestore()
    }
  })
})
