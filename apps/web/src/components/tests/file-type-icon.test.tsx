import { FileIconSprite } from '@/components/file-icon-sprite'
import { FileTypeIcon } from '@/components/file-type-icon'
import { fileIconSpriteSymbols, iconForEntry } from '@/lib/file-icons'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'

test.each(['index.html', '.prettierrc', 'next.config.js', 'component.tsx', 'unknown.file'])(
  'inline icons draw the sprite symbol’s artwork and viewBox for %s',
  (name) => {
    const icon = iconForEntry({ name, type: 'file' })
    const { container } = renderWithProviders(<FileTypeIcon icon={icon} />)
    const svg = container.querySelector('svg')!
    const sprite = document.createElement('div')
    sprite.innerHTML = `<svg>${fileIconSpriteSymbols()}</svg>`
    const symbol = sprite.querySelector(`#app-vscode-icon-${svg.getAttribute('data-file-icon')}`)!

    expect(svg.getAttribute('viewBox')).toBe(symbol.getAttribute('viewBox'))
    expect(Array.from(svg.querySelectorAll('path'), (path) => path.getAttribute('d'))).toEqual(
      Array.from(symbol.querySelectorAll('path'), (path) => path.getAttribute('d')),
    )
    expect(svg.querySelector('image, use')).toBeNull()
    expect(svg.getAttribute('style') ?? '').not.toContain('mask')
  },
)

test('sprite icons use the symbol the document sprite defines, in their hue', () => {
  const { container } = renderWithProviders(
    <>
      <FileIconSprite />
      <FileTypeIcon icon={iconForEntry({ name: 'main.c', type: 'file' })} sprite />
    </>,
  )
  const svg = container.querySelector('svg[data-file-icon]')!
  const href = svg.querySelector('use')!.getAttribute('href')!

  expect(container.querySelector(`[data-file-icon-sprite] symbol${href}`)).not.toBeNull()
  expect(svg.getAttribute('class')).toContain('text-file-icon-blue')
  expect(svg.querySelector('path')).toBeNull()
})

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

test('the icon takes its hue as a class, with no inline colour', () => {
  const { container } = renderWithProviders(
    <FileTypeIcon icon={iconForEntry({ name: 'main.c', type: 'file' })} />,
  )
  const svg = container.querySelector('svg')!

  expect(svg.getAttribute('class')).toContain('text-file-icon-blue')
  expect(svg.getAttribute('style')).toBeNull()
})

test('a Catppuccin icon paints its own colours through the hue tokens', () => {
  const { container } = renderWithProviders(
    <FileTypeIcon icon={iconForEntry({ name: 'Main.java', type: 'file' })} />,
  )
  const styles = Array.from(container.querySelectorAll('path'), (path) =>
    path.getAttribute('style'),
  )

  expect(styles).toContain('stroke:var(--file-icon-red)')
  expect(styles).toContain('stroke:var(--file-icon-neutral)')
  expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/iu)
})
