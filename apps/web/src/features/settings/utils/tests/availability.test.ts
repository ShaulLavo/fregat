import { describe, expect, it } from 'vitest'

import {
  isSettingAvailable,
  settingAvailabilityReason,
  materialOptionReason,
  type SettingEnvironment,
} from '../availability'

describe('isSettingAvailable', () => {
  it('hides the window transparency row where there is no window to re-create', () => {
    // A browser on a Linux desktop is composited over the wallpaper too, but it
    // has no shell window to make transparent.
    expect(
      isSettingAvailable('window.transparency', {
        backdrop: 'compositor',
        nativeTransparency: false,
      }),
    ).toBe(false)
    expect(
      isSettingAvailable('window.transparency', { backdrop: 'app', nativeTransparency: true }),
    ).toBe(false)
  })

  it('shows it in a shell whose desktop composites the window', () => {
    expect(
      isSettingAvailable('window.transparency', {
        backdrop: 'compositor',
        nativeTransparency: true,
      }),
    ).toBe(true)
    expect(
      isSettingAvailable('window.transparency', {
        backdrop: 'transparent',
        nativeTransparency: true,
      }),
    ).toBe(true)
  })

  it('leaves every other row alone', () => {
    expect(
      isSettingAvailable('workbench.wallpaper', { backdrop: 'app', nativeTransparency: false }),
    ).toBe(true)
    expect(
      isSettingAvailable('workbench.wallpaper', {
        backdrop: 'compositor',
        nativeTransparency: true,
      }),
    ).toBe(true)
  })
})

it('keeps material visible with an availability reason in a transparent macOS host with the appearance method', () => {
  const supported = {
    backdrop: 'transparent',
    nativeTransparency: true,
    platform: 'darwin',
    windowAppearance: true,
  } as const
  expect(isSettingAvailable('window.material', supported)).toBe(true)
  const overrides: readonly Partial<SettingEnvironment>[] = [
    { backdrop: 'app' },
    { backdrop: 'compositor' },
    { platform: 'linux' },
    { platform: 'win32' },
    { windowAppearance: false },
  ]
  for (const override of overrides) {
    expect(isSettingAvailable('window.material', { ...supported, ...override })).toBe(true)
    expect(settingAvailabilityReason('window.material', { ...supported, ...override })).toBe(
      'Needs a transparent macOS app window.',
    )
  }
  expect(
    isSettingAvailable('window.material', { backdrop: 'transparent', nativeTransparency: true }),
  ).toBe(true)
})

it('hides the page blur row only where native frost owns desktop blur', () => {
  const supported = {
    backdrop: 'transparent',
    nativeTransparency: true,
    platform: 'darwin',
    windowAppearance: true,
  } as const
  expect(isSettingAvailable('workbench.surface.blur', supported)).toBe(false)
  expect(isSettingAvailable('workbench.surface.blur', { ...supported, platform: 'linux' })).toBe(
    true,
  )
  expect(
    isSettingAvailable('workbench.surface.blur', { ...supported, windowAppearance: false }),
  ).toBe(true)
  expect(isSettingAvailable('workbench.surface.blur', { ...supported, backdrop: 'app' })).toBe(true)
})

it('keeps opacity visible and marks it unavailable only while native material owns the pane', () => {
  const environment: SettingEnvironment = {
    platform: 'darwin',
    backdrop: 'transparent',
    nativeTransparency: true,
    windowAppearance: true,
    material: 'frosted',
  }
  expect(isSettingAvailable('workbench.surface.opacity', environment)).toBe(true)
  expect(settingAvailabilityReason('workbench.surface.contentOpacity', environment)).toBe(
    'Window material controls pane opacity.',
  )
  expect(settingAvailabilityReason('workbench.surface.opacity', environment)).toBe(
    'Window material controls pane opacity.',
  )
  expect(
    settingAvailabilityReason('workbench.surface.opacity', { ...environment, material: 'none' }),
  ).toBeNull()
  expect(
    settingAvailabilityReason('workbench.surface.opacity', { ...environment, platform: 'linux' }),
  ).toBeNull()
})

it('requires runtime Glass support while leaving None and Frosted available', () => {
  const environment: SettingEnvironment = {
    platform: 'darwin',
    backdrop: 'transparent',
    nativeTransparency: true,
    windowAppearance: true,
  }
  expect(materialOptionReason('glass', environment)).toBe('Glass needs macOS 26.')
  expect(materialOptionReason('glass', { ...environment, windowGlass: true })).toBeNull()
  expect(materialOptionReason('frosted', environment)).toBeNull()
  expect(materialOptionReason('none', environment)).toBeNull()
})
