import { FileTypeIcon } from '@/components/file-type-icon'
import { fileTreeIconsForPaths, iconForEntry } from '@/lib/file-icons'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'

test.each(['index.html', '.prettierrc', 'next.config.js', 'component.tsx', 'unknown.file'])(
  'inline icons preserve the tree artwork and viewBox for %s',
  (name) => {
    const icon = iconForEntry({ name, type: 'file' })
    const { container } = renderWithProviders(<FileTypeIcon icon={icon} />)
    const svg = container.querySelector('svg')!
    const sprite = document.createElement('div')
    sprite.innerHTML = fileTreeIconsForPaths([name]).spriteSheet ?? ''
    const symbol = sprite.querySelector(`#app-vscode-icon-${icon.name}`)!

    expect(svg.getAttribute('viewBox')).toBe(symbol.getAttribute('viewBox'))
    expect(Array.from(svg.querySelectorAll('path'), (path) => path.getAttribute('d'))).toEqual(
      Array.from(symbol.querySelectorAll('path'), (path) => path.getAttribute('d')),
    )
    expect(svg.querySelector('image, use')).toBeNull()
    expect(svg.getAttribute('style')).not.toContain('mask')
  },
)

test('repeated gradient icons reference their own definitions', () => {
  const icon = iconForEntry({ name: 'next.config.js', type: 'file' })
  const { container } = renderWithProviders(
    <>
      <span hidden>
        <FileTypeIcon icon={icon} />
      </span>
      <FileTypeIcon icon={icon} />
    </>,
  )
  const icons = Array.from(container.querySelectorAll('svg'))
  const ids = icons.map((svg) => svg.querySelector('linearGradient')!.id)
  expect(new Set(ids).size).toBe(2)
  for (const [index, svg] of icons.entries()) {
    expect(svg.querySelector('path[fill^="url"]')?.getAttribute('fill')).toBe(`url(#${ids[index]})`)
  }
})
