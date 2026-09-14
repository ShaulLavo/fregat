import { describe, expect, it } from 'vitest'
import { humanizeSettingId } from '@workspace/client-core/settings/humanize'

describe('humanizeSettingId', () => {
  it('drops the namespace and splits camelCase', () => {
    expect(humanizeSettingId('workbench.colorTheme')).toBe('Color theme')
    expect(humanizeSettingId('editor.diff.viewMode')).toBe('Diff view mode')
  })

  it('keeps the qualifier a generic leaf needs to mean anything', () => {
    // "Enabled" on its own says nothing, and generic leaves are the ones that
    // repeat across namespaces.
    expect(humanizeSettingId('workbench.wallpaper')).toBe('Wallpaper')
    expect(humanizeSettingId('workbench.surface.opacity')).toBe('Surface opacity')
  })

  it('leaves a single-segment id alone', () => {
    expect(humanizeSettingId('keybindings')).toBe('Keybindings')
  })
})
