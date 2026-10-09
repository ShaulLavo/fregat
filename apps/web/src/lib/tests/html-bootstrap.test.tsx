import { vi } from 'vitest'
import { HTML_BOOTSTRAP_ID } from '@workspace/contracts/html-bootstrap'
import { readHtmlBootstrap, initialAppearanceValues } from '@/lib/html-bootstrap'
import { readSettingBootValue, writeBootMirror } from '@/lib/settings-boot-mirror'
import { BUNDLED_THEMES, DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { test, expect } from '../../../test/fixtures'
import { installHtmlBootstrap } from '../../../test/factories/html-bootstrap'

test('startup uses the document once while stale or blocked storage cannot change appearance', () => {
  installHtmlBootstrap({
    'workbench.surface.opacity': 37,
    'workbench.wallpaper': { enabled: false, source: { kind: 'desktop' } },
  })
  const first = readHtmlBootstrap()
  expect(readHtmlBootstrap()).toBe(first)
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked storage', 'SecurityError')
  })
  try {
    expect(initialAppearanceValues()['workbench.surface.opacity']).toBe(37)
    expect(readSettingBootValue('workbench.surface.opacity')).toBe(37)
    expect(read).not.toHaveBeenCalled()
  } finally {
    read.mockRestore()
  }
})

test('confirmed appearance changes are held in memory and do not replace the immutable HTML value', () => {
  installHtmlBootstrap({ 'workbench.surface.opacity': 37 })
  const initial = readHtmlBootstrap()
  writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'workbench.surface.opacity': 62 })
  expect(readSettingBootValue('workbench.surface.opacity')).toBe(62)
  expect(readHtmlBootstrap()).toBe(initial)
  expect(initialAppearanceValues()['workbench.surface.opacity']).toBe(37)
  expect(
    JSON.parse(localStorage.getItem('platform.settings-boot-mirror.v1')!)[
      'workbench.surface.opacity'
    ],
  ).toBeUndefined()
})

test('another owner cannot adopt the document appearance', () => {
  installHtmlBootstrap({ 'workbench.surface.opacity': 37 })
  expect(
    initialAppearanceValues('https://another-owner.test')['workbench.surface.opacity'],
  ).not.toBe(37)
})

test('direct confirmed reads use the selected theme rather than raw top-level appearance', () => {
  const theme = BUNDLED_THEMES[0]!
  const variant = {
    ...theme.variants.dark,
    wallpaper: { ...theme.variants.dark.wallpaper, enabled: false },
  }
  writeBootMirror({
    ...DEFAULT_SETTING_VALUES,
    'workbench.colorTheme': 'dark',
    'workbench.wallpaper': { enabled: true, source: { kind: 'desktop' } },
    'workbench.theme': { ...theme, variants: { light: variant, dark: variant } },
  })
  expect(readSettingBootValue('workbench.wallpaper').enabled).toBe(false)
})

test('malformed document data has no wallpaper authority', () => {
  const script = document.createElement('script')
  script.id = HTML_BOOTSTRAP_ID
  script.textContent = '{broken'
  document.head.append(script)
  expect(readHtmlBootstrap()).toBeNull()
  expect(initialAppearanceValues()['workbench.wallpaper'].enabled).toBe(false)
})
