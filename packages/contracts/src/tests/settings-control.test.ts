import { describe, expect, it } from 'vitest'
import { settingControl } from '../settings/control'

describe('settingControl', () => {
  it('carries a picklist enum its options', () => {
    expect(settingControl('workbench.colorTheme', 'dark')).toEqual({
      widget: 'enum',
      value: 'dark',
      options: ['dark', 'light', 'system'],
    })
  })

  it('narrows a scalar to the control that renders it', () => {
    expect(settingControl('editor.fontSize', 13)).toEqual({ widget: 'number', value: 13 })
    expect(
      settingControl('workbench.wallpaper', { enabled: true, source: { kind: 'desktop' } }),
    ).toEqual({
      widget: 'wallpaper',
      value: { enabled: true, source: { kind: 'desktop' } },
    })
    expect(settingControl('editor.fontFamily', 'JetBrainsMono')).toEqual({
      widget: 'font',
      value: 'JetBrainsMono',
    })
  })

  it('carries schema-authorized nullable strings into a text control', () => {
    expect(settingControl('providers.proxyUsageUrl', null)).toEqual({
      widget: 'string',
      value: null,
      nullable: true,
    })
    expect(settingControl('providers.proxyUsageUrl', 'http://127.0.0.1:8317')).toEqual({
      widget: 'string',
      value: 'http://127.0.0.1:8317',
      nullable: true,
    })
    expect(settingControl('server.address', 'http://127.0.0.1:3301')).toEqual({
      widget: 'string',
      value: 'http://127.0.0.1:3301',
      nullable: false,
    })
    expect(settingControl('server.address', null)).toEqual({ widget: 'unsupported' })
    expect(settingControl('providers.proxyUsageUrl', 42)).toEqual({ widget: 'unsupported' })
  })

  it('parses a structured value rather than casting it', () => {
    // Value-less, like `models`: the section sources its own rows from the
    // keymap, so the stored list tells the control nothing.
    expect(
      settingControl('keybindings.overrides', [{ keys: 'Mod+S', command: 'workspace.saveFile' }]),
    ).toEqual({
      widget: 'keybindings',
    })
    expect(settingControl('providers.instances', [])).toEqual({ widget: 'providers', value: [] })
    // The model catalogue is not in the settings document, so the control gets
    // no value to render.
    expect(settingControl('models.hidden', [])).toEqual({ widget: 'models' })
  })

  it('gives a value that does not match its widget no control', () => {
    // The resolver never produces one of these — it rejects a layer value that
    // fails its schema and reports an `invalid-value` diagnostic instead of
    // applying it. The case exists because the function has to be total.
    expect(settingControl('editor.fontSize', 'thirteen')).toEqual({ widget: 'unsupported' })
    expect(settingControl('providers.instances', 'nope')).toEqual({ widget: 'unsupported' })
  })
})
