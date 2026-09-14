import { describe, expect, it } from 'vitest'

import { isSettingAvailable } from '../availability'

describe('isSettingAvailable', () => {
  it('hides the window transparency row where there is no window to re-create', () => {
    // A browser on a Linux desktop is composited over the wallpaper too, but it
    // has no shell window to make transparent.
    expect(
      isSettingAvailable('window.transparency', { backdrop: 'compositor', isShell: false }),
    ).toBe(false)
    expect(isSettingAvailable('window.transparency', { backdrop: 'app', isShell: true })).toBe(
      false,
    )
  })

  it('shows it in a shell whose desktop composites the window', () => {
    expect(
      isSettingAvailable('window.transparency', { backdrop: 'compositor', isShell: true }),
    ).toBe(true)
    expect(
      isSettingAvailable('window.transparency', { backdrop: 'transparent', isShell: true }),
    ).toBe(true)
  })

  it('leaves every other row alone', () => {
    expect(isSettingAvailable('workbench.wallpaper', { backdrop: 'app', isShell: false })).toBe(
      true,
    )
    expect(
      isSettingAvailable('workbench.wallpaper', { backdrop: 'compositor', isShell: true }),
    ).toBe(true)
  })
})
