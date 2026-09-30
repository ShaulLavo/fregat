import { expect, test } from 'vitest'

import { applyEditorTheme, resolveEditorThemeColor } from '../src/theme'

test('standalone resolution paints what a themed element paints when fields and names conflict', () => {
  const theme = {
    foregroundColor: '#111111',
    syntax: { keyword: '#ff0000' },
    colors: { 'syntax.keyword': '#0000ff', foreground: '#00ff00' },
  }
  const element = document.createElement('span')
  document.body.append(element)
  try {
    applyEditorTheme(element, theme)
    for (const variable of ['var(--editor-syntax-keyword)', 'var(--editor-foreground)']) {
      element.style.color = variable
      const painted = getComputedStyle(element).color
      element.style.color = resolveEditorThemeColor(variable, theme)!
      expect(getComputedStyle(element).color).toBe(painted)
    }
  } finally {
    element.remove()
  }
})
