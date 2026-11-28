import { FileIconSprite } from '@/components/files/file-icon-sprite'
import { FileTypeIcon } from '@/components/files/file-type-icon'
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
    const symbol = sprite.querySelector(`#wb-file-icon-${svg.getAttribute('data-wb-icon')}`)!

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
  const svg = container.querySelector('svg[data-wb-icon]')!
  const href = svg.querySelector('use')!.getAttribute('href')!

  expect(container.querySelector(`[data-wb-icon-sprite] symbol${href}`)).not.toBeNull()
  expect(svg.getAttribute('data-wb-icon-hue')).toBe('blue')
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

test('the icon takes its hue as a semantic data attribute, with no inline colour', () => {
  const { container } = renderWithProviders(
    <FileTypeIcon icon={iconForEntry({ name: 'main.c', type: 'file' })} />,
  )
  const svg = container.querySelector('svg')!

  expect(svg.getAttribute('data-wb-icon-hue')).toBe('blue')
  expect(svg.getAttribute('style')).toBeNull()
})

test('a Catppuccin icon paints its own colours through the hue tokens', () => {
  const { container } = renderWithProviders(
    <FileTypeIcon icon={iconForEntry({ name: 'Main.java', type: 'file' })} />,
  )
  const strokes = Array.from(container.querySelectorAll('path'), (path) =>
    path.getAttribute('stroke'),
  ).filter((value): value is string => value !== null)

  expect(strokes.length).toBeGreaterThan(0)
  expect(
    strokes.some((stroke) => stroke.includes('var(--wb-icon-') || stroke === 'currentColor'),
  ).toBe(true)
  expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/iu)
})
