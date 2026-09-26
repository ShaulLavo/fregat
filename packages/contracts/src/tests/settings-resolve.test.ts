import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { DEFAULT_SETTING_VALUES } from '../settings/keys'
import { defineSetting } from '../settings/registry'
import {
  inspectSetting,
  policyControlledIds,
  resolveSettings,
  type SettingsLayer,
} from '../settings/resolve'

/**
 * A fixture registry rather than the shipping one.
 *
 * Every key registered in phase 1 is `application` scope, so the workspace layer
 * can never carry one — user-vs-workspace precedence is untestable against the
 * real table until phase 3 adds a `window` key. Passing a registry keeps the
 * resolver a pure function of (registry, layers) instead of one with a hidden
 * global, and lets the precedence rules be proven now rather than assumed.
 */
const registry = {
  'editor.fontSize': defineSetting({
    schema: v.pipe(v.number(), v.minValue(1)),
    default: 13,
    scope: 'window',
    widget: 'number',
    category: 'Editor',
    description: 'Font size in pixels.',
  }),
  'terminal.shell': defineSetting({
    schema: v.string(),
    default: '/bin/zsh',
    // Reaches process spawn, so the workspace layer must not be able to set it.
    scope: 'machine',
    widget: 'string',
    category: 'Terminal',
    description: 'Shell binary.',
  }),
  'keybindings.overrides': defineSetting({
    schema: v.record(v.string(), v.nullable(v.string())),
    default: {},
    scope: 'window',
    widget: 'record',
    category: 'Keyboard shortcuts',
    description: 'Command id to hotkey.',
    merge: 'record',
  }),
}

const layer = (id: SettingsLayer['id'], raw: Record<string, unknown>): SettingsLayer => ({
  id,
  raw,
})

describe('settings resolution', () => {
  it('falls back to registry defaults when no layer sets anything', () => {
    const { values, diagnostics } = resolveSettings([], { registry })

    expect(values['editor.fontSize']).toBe(13)
    expect(values['terminal.shell']).toBe('/bin/zsh')
    expect(diagnostics).toEqual([])
  })

  it('lets the workspace layer win over the user layer', () => {
    const { values } = resolveSettings(
      [layer('user', { 'editor.fontSize': 15 }), layer('workspace', { 'editor.fontSize': 18 })],
      { registry },
    )

    expect(values['editor.fontSize']).toBe(18)
  })

  it('applies layers in precedence order regardless of the order they arrive in', () => {
    const { values } = resolveSettings(
      [layer('workspace', { 'editor.fontSize': 18 }), layer('user', { 'editor.fontSize': 15 })],
      { registry },
    )

    expect(values['editor.fontSize']).toBe(18)
  })

  it('lets policy beat every other layer', () => {
    const { values } = resolveSettings(
      [
        layer('user', { 'editor.fontSize': 15 }),
        layer('workspace', { 'editor.fontSize': 18 }),
        layer('policy', { 'editor.fontSize': 12 }),
      ],
      { registry },
    )

    expect(values['editor.fontSize']).toBe(12)
  })

  it('drops a machine-scoped key set by a workspace and says why', () => {
    const { values, diagnostics } = resolveSettings(
      [layer('workspace', { 'terminal.shell': '/tmp/evil' })],
      { registry },
    )

    expect(values['terminal.shell']).toBe('/bin/zsh')
    expect(diagnostics).toEqual([
      {
        kind: 'scope-not-allowed',
        id: 'terminal.shell',
        layer: 'workspace',
        detail: 'machine settings cannot be set in workspace settings',
      },
    ])
  })

  it('still honours a machine-scoped key from the user layer', () => {
    const { values, diagnostics } = resolveSettings(
      [layer('user', { 'terminal.shell': '/bin/fish' })],
      { registry },
    )

    expect(values['terminal.shell']).toBe('/bin/fish')
    expect(diagnostics).toEqual([])
  })

  it('reports an unknown key without dropping it from the layer', () => {
    const user = layer('user', { 'editor.fontSize': 15, 'editor.fromANewerBuild': true })
    const { values, diagnostics } = resolveSettings([user], { registry })

    expect(values['editor.fontSize']).toBe(15)
    expect(diagnostics).toEqual([
      { kind: 'unknown-key', id: 'editor.fromANewerBuild', layer: 'user' },
    ])
    // The layer is the write path's input; an unknown key surviving here is what
    // keeps a save from deleting settings a newer build wrote.
    expect(user.raw['editor.fromANewerBuild']).toBe(true)
  })

  it('falls back per key rather than failing the document', () => {
    const { values, diagnostics } = resolveSettings(
      [layer('user', { 'editor.fontSize': -4, 'terminal.shell': '/bin/fish' })],
      { registry },
    )

    expect(values['editor.fontSize']).toBe(13)
    expect(values['terminal.shell']).toBe('/bin/fish')
    expect(diagnostics[0]).toMatchObject({ kind: 'invalid-value', id: 'editor.fontSize' })
  })

  it('merges a record key across layers instead of replacing it', () => {
    const { values } = resolveSettings(
      [
        layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+1', 'a.two': 'Mod+2' } }),
        layer('workspace', { 'keybindings.overrides': { 'a.two': 'Mod+9', 'a.three': null } }),
      ],
      { registry },
    )

    expect(values['keybindings.overrides']).toEqual({
      'a.one': 'Mod+1',
      'a.two': 'Mod+9',
      'a.three': null,
    })
  })

  it('lets policy replace a record key outright rather than merging into it', () => {
    const { values } = resolveSettings(
      [
        layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+1' } }),
        layer('policy', { 'keybindings.overrides': { 'a.locked': 'Mod+L' } }),
      ],
      { registry },
    )

    expect(values['keybindings.overrides']).toEqual({ 'a.locked': 'Mod+L' })
  })

  it('names the ids a policy layer controls', () => {
    const layers = [layer('policy', { 'editor.fontSize': 12, 'not.registered': true })]

    expect(policyControlledIds(layers, registry)).toEqual(['editor.fontSize'])
  })
})

describe('resolution identity', () => {
  it('hands back the previous value when a key resolves to an equal one', () => {
    const first = resolveSettings(
      [layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+1' } })],
      { registry },
    )
    // A distinct object holding equal content — what a file reload produces even
    // when the bytes did not change. `v.parse` allocates a fresh record for it,
    // so the only way this can be reference-equal is the previous-value reuse.
    const second = resolveSettings(
      [layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+1' } })],
      { registry, previous: first.values },
    )

    expect(second.values['keybindings.overrides']).not.toEqual({})
    expect(second.values['keybindings.overrides']).toBe(first.values['keybindings.overrides'])
  })

  it('reuses across a change to an unrelated key', () => {
    const first = resolveSettings(
      [layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+1' }, 'editor.fontSize': 15 })],
      { registry },
    )
    const second = resolveSettings(
      [layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+1' }, 'editor.fontSize': 20 })],
      { registry, previous: first.values },
    )

    expect(second.values['editor.fontSize']).toBe(20)
    // The whole point: dragging one slider must not hand every keymap consumer a
    // new object and re-register the binding table.
    expect(second.values['keybindings.overrides']).toBe(first.values['keybindings.overrides'])
  })

  it('returns a fresh value once the key actually changes', () => {
    const first = resolveSettings(
      [layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+1' } })],
      { registry },
    )
    const second = resolveSettings(
      [layer('user', { 'keybindings.overrides': { 'a.one': 'Mod+2' } })],
      { registry, previous: first.values },
    )

    expect(second.values['keybindings.overrides']).not.toBe(first.values['keybindings.overrides'])
    expect(second.values['keybindings.overrides']).toEqual({ 'a.one': 'Mod+2' })
  })

  it('does not merge when only one layer contributes a record key', () => {
    const overrides = { 'a.one': 'Mod+1' }
    const { values } = resolveSettings([layer('user', { 'keybindings.overrides': overrides })], {
      registry,
    })

    // The merge path would build a new record by spreading; the single-contributor
    // path returns the parsed value straight through. Both produce equal content,
    // so this pins the behaviour rather than the allocation.
    expect(values['keybindings.overrides']).toEqual(overrides)
  })
})

describe('inspectSetting', () => {
  it('reports every layer that set the key, applied or not', () => {
    const layers = [
      layer('user', { 'terminal.shell': '/bin/fish' }),
      layer('workspace', { 'terminal.shell': '/tmp/evil' }),
    ]
    const resolution = resolveSettings(layers, { registry })
    const inspection = inspectSetting('terminal.shell', layers, resolution, registry)

    expect(inspection.layers).toEqual([
      { layer: 'user', value: '/bin/fish', applied: true },
      { layer: 'workspace', value: '/tmp/evil', applied: false },
    ])
    expect(inspection.effective).toBe('/bin/fish')
    expect(inspection.effectiveLayer).toBe('user')
    expect(inspection.defaultValue).toBe('/bin/zsh')
  })

  it('reports the default when no layer sets the key', () => {
    const resolution = resolveSettings([], { registry })
    const inspection = inspectSetting('editor.fontSize', [], resolution, registry)

    expect(inspection.layers).toEqual([])
    expect(inspection.effectiveLayer).toBe('default')
    expect(inspection.effective).toBe(13)
  })

  it('agrees with the resolved document it was given', () => {
    const layers = [
      layer('user', { 'editor.fontSize': 15 }),
      layer('workspace', { 'editor.fontSize': 18 }),
    ]
    const resolution = resolveSettings(layers, { registry })
    const inspection = inspectSetting('editor.fontSize', layers, resolution, registry)

    expect(inspection.effective).toBe(resolution.values['editor.fontSize'])
    expect(inspection.effectiveLayer).toBe('workspace')
  })
})

describe('the shipping registry', () => {
  it('resolves an empty document to the registered defaults', () => {
    const { values } = resolveSettings([])

    expect(values).toEqual(DEFAULT_SETTING_VALUES)
  })

  it('refuses a provider list from a workspace file', () => {
    const { values, diagnostics } = resolveSettings([
      layer('workspace', {
        'providers.instances': [{ providerInstanceId: 'evil', driverKind: 'codex' }],
      }),
    ])

    expect(values['providers.instances']).toEqual([])
    expect(diagnostics[0]).toMatchObject({
      kind: 'scope-not-allowed',
      id: 'providers.instances',
    })
  })

  it('accepts a real keybinding override from the user file', () => {
    const { values, diagnostics } = resolveSettings([
      layer('user', { 'keybindings.overrides': { 'workspace.saveFile': 'Mod+Alt+S' } }),
    ])

    expect(values['keybindings.overrides']).toEqual({ 'workspace.saveFile': 'Mod+Alt+S' })
    expect(diagnostics).toEqual([])
  })
})

describe('dependsOn', () => {
  const dependent = {
    'files.watch': defineSetting({
      schema: v.boolean(),
      default: true,
      scope: 'window',
      widget: 'boolean',
      category: 'Files',
      description: 'Watch files.',
    }),
    'files.watchHidden': defineSetting({
      schema: v.boolean(),
      default: true,
      scope: 'window',
      widget: 'boolean',
      category: 'Files',
      dependsOn: 'files.watch',
      description: 'Watch hidden files too.',
    }),
    'files.watchLimit': defineSetting({
      schema: v.number(),
      default: 10,
      scope: 'window',
      widget: 'number',
      category: 'Files',
      dependsOn: 'files.watch',
      description: 'Most files watched.',
    }),
  }

  it('reads a boolean child as off while its parent is off, and keeps other children', () => {
    const { values } = resolveSettings(
      [layer('user', { 'files.watch': false, 'files.watchHidden': true, 'files.watchLimit': 4 })],
      { registry: dependent },
    )

    expect(values['files.watchHidden']).toBe(false)
    expect(values['files.watchLimit']).toBe(4)
  })

  it("gives a child its own value back once the parent is on, and inspect keeps the child's layer", () => {
    const layers = [
      layer('user', { 'files.watch': false, 'files.watchHidden': true }),
      layer('workspace', { 'files.watch': true }),
    ]
    const resolution = resolveSettings(layers, { registry: dependent })

    expect(resolution.values['files.watchHidden']).toBe(true)
    expect(inspectSetting('files.watchHidden', layers, resolution, dependent).effectiveLayer).toBe(
      'user',
    )
  })
})
