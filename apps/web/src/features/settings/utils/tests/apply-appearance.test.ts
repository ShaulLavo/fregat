import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'
import { applyAppearance, resolveColorTheme, type AppearanceValues } from '../apply-appearance'

function fakeRoot() {
  const classes = new Set<string>()
  const properties = new Map<string, string>()
  const attributes = new Map<string, string>()

  return {
    attributes,
    classes,
    properties,
    root: {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      } as unknown as HTMLElement['classList'],
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
      } as unknown as HTMLElement['style'],
      removeAttribute: (name: string) => attributes.delete(name),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    },
  }
}

const appearance = (overrides: Partial<AppearanceValues> = {}): AppearanceValues => ({
  'editor.fontFamily': DEFAULT_SETTING_VALUES['editor.fontFamily'],
  'workbench.colorTheme': DEFAULT_SETTING_VALUES['workbench.colorTheme'],
  'workbench.density': DEFAULT_SETTING_VALUES['workbench.density'],
  'workbench.fontFamily': DEFAULT_SETTING_VALUES['workbench.fontFamily'],
  'workbench.surface.blur': DEFAULT_SETTING_VALUES['workbench.surface.blur'],
  'workbench.surface.contentOpacity': DEFAULT_SETTING_VALUES['workbench.surface.contentOpacity'],
  'workbench.surface.opacity': DEFAULT_SETTING_VALUES['workbench.surface.opacity'],
  'workbench.surface.saturation': DEFAULT_SETTING_VALUES['workbench.surface.saturation'],
  'workbench.tree.indentGuides': DEFAULT_SETTING_VALUES['workbench.tree.indentGuides'],
  'workbench.wallpaper': DEFAULT_SETTING_VALUES['workbench.wallpaper'],
  ...overrides,
})

describe('resolveColorTheme', () => {
  it('follows the system query only when the setting says system', () => {
    expect(resolveColorTheme('system', true)).toBe('dark')
    expect(resolveColorTheme('system', false)).toBe('light')
    expect(resolveColorTheme('light', true)).toBe('light')
    expect(resolveColorTheme('dark', false)).toBe('dark')
  })
})

describe('applyAppearance', () => {
  it('replaces the theme class rather than accumulating one', () => {
    const { classes, root } = fakeRoot()

    applyAppearance(appearance({ 'workbench.colorTheme': 'dark' }), root, false)
    applyAppearance(appearance({ 'workbench.colorTheme': 'light' }), root, false)

    expect([...classes]).toEqual(['light'])
  })

  it('writes the interface and code font stacks', () => {
    const { properties, root } = fakeRoot()

    applyAppearance(
      appearance({
        'editor.fontFamily': 'nerd:FiraCode',
        'workbench.fontFamily': 'fontsource:geist',
      }),
      root,
      false,
    )

    expect(properties.get('--font-ui')).toMatch(/^"geist Fontsource", "Inter Variable"/u)
    expect(properties.get('--font-code')).toMatch(
      /^"FiraCode Nerd Font", "JetBrains Mono Variable"/u,
    )
  })

  it('writes the four material knobs with their CSS units', () => {
    const { properties, root } = fakeRoot()

    applyAppearance(
      appearance({
        'workbench.surface.blur': 0,
        'workbench.surface.contentOpacity': 90,
        'workbench.surface.opacity': 100,
        'workbench.surface.saturation': 100,
      }),
      root,
      false,
    )

    // A unitless number is not a valid value for any of these; the whole
    // material silently stops applying if the suffix is dropped.
    expect(properties.get('--surface-opacity')).toBe('100%')
    expect(properties.get('--content-opacity')).toBe('90%')
    expect(properties.get('--surface-blur')).toBe('0px')
    expect(properties.get('--surface-saturation')).toBe('100%')
  })

  it('toggles the wallpaper attribute both ways', () => {
    const { attributes, root } = fakeRoot()

    applyAppearance(
      appearance({ 'workbench.wallpaper': { enabled: false, source: { kind: 'desktop' } } }),
      root,
      false,
    )
    expect(attributes.has('data-wallpaper-hidden')).toBe(true)

    applyAppearance(
      appearance({
        'workbench.wallpaper': { enabled: true, source: { kind: 'desktop' } },
      }),
      root,
      false,
    )
    expect(attributes.has('data-wallpaper-hidden')).toBe(false)
  })

  it('writes interface density as an attribute value the CSS can select on', () => {
    const { attributes, root } = fakeRoot()

    applyAppearance(appearance({ 'workbench.density': 'cozy' }), root, false)
    expect(attributes.get('data-density')).toBe('cozy')

    applyAppearance(appearance({ 'workbench.density': 'compact' }), root, false)
    expect(attributes.get('data-density')).toBe('compact')
  })

  it('applies registry defaults without a stored document', () => {
    const { classes, properties, root } = fakeRoot()

    applyAppearance(appearance(), root, true)

    expect([...classes]).toEqual(['dark'])
    expect(properties.get('--surface-opacity')).toBe('80%')
  })

  it('maps file tree indent guide visibility onto inherited package variables', () => {
    const { properties, root } = fakeRoot()

    applyAppearance(appearance({ 'workbench.tree.indentGuides': 'none' }), root, false)
    expect(properties.get('--trees-indent-guide-opacity-override')).toBe('0')
    expect(properties.get('--trees-indent-guide-hover-opacity-override')).toBe('0')
    expect(properties.get('--trees-indent-guide-active-opacity-override')).toBe('0')

    applyAppearance(appearance({ 'workbench.tree.indentGuides': 'always' }), root, false)
    expect(properties.get('--trees-indent-guide-opacity-override')).toBe('1')
    expect(properties.get('--trees-indent-guide-hover-opacity-override')).toBe('1')
    expect(properties.get('--trees-indent-guide-active-opacity-override')).toBe('1')
  })
})
