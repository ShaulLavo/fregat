import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import { modelRefSchema, REDACTED_SETTINGS_VALUE, type ModelRef } from '../settings'
import { DEFAULT_SETTING_VALUES, descriptorFor, SETTING_IDS } from '../settings/keys'
import {
  applySettingsOperations,
  SCALAR_SETTING_IDS,
  settingsEventSchema,
  settingsMutationRequestSchema,
  settingsMutationResourcesIntersect,
  settingsMutationResultSchema,
  settingsOperationResourceKeys,
  settingsOperationSchema,
  settingsRawWriteRequestSchema,
  settingsRawWriteResultSchema,
  type ScalarSettingOperation,
  type SettingsOperation,
} from '../settings/mutations'
import { settingsSnapshotSchema } from '../settings/wire'

const _paletteSetIsScalar: ScalarSettingOperation = {
  kind: 'set',
  key: 'workbench.palette',
  value: 'sage',
}

// @ts-expect-error the value is narrowed by the scalar setting key
const _densityRejectsPalette: ScalarSettingOperation = {
  kind: 'set',
  key: 'workbench.density',
  value: 'sage',
}

void _paletteSetIsScalar
void _densityRejectsPalette

const MODEL_A = modelRef('codex', 'gpt-5')
const MODEL_B = modelRef('claude', 'sonnet')

describe('settings mutation schemas', () => {
  it('covers every live scalar, including the committed post-plan additions', () => {
    // Named by what makes a key NOT scalar: it has a bespoke mutation operation
    // because one `set` cannot express an edit to it. Every other widget writes
    // its whole value at once, whatever shape that value has — `code-theme` is a
    // theme-id string, `palette` a palette id, `wallpaper` a per-mode object, and
    // all three go through the scalar path.
    //
    // Listed as the complement on purpose. An allowlist of scalar widgets has to
    // be edited every time a widget is added, and it silently went stale twice:
    // this assertion and the `arrayContaining` below it had been contradicting
    // each other since `workbench.palette` stopped being an enum. Adding a widget
    // that genuinely needs its own operations is the rare case, and the one worth
    // stopping on.
    const bespokeWidgets = new Set(['complex', 'keybindings', 'machines', 'models', 'providers'])
    const expected = SETTING_IDS.filter((id) => !bespokeWidgets.has(descriptorFor(id).widget))

    expect(SCALAR_SETTING_IDS).toEqual(expected)
    expect(SCALAR_SETTING_IDS).toEqual(
      expect.arrayContaining([
        'workbench.palette',
        'workbench.density',
        'files.showHidden',
        'editor.codeTheme.dark',
        'editor.codeTheme.light',
      ]),
    )
  })

  it('narrows scalar values by key and exposes no generic collection replacement or toggle', () => {
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'set',
        key: 'workbench.density',
        value: 'cozy',
      }).success,
    ).toBe(true)
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'set',
        key: 'workbench.density',
        value: 'sage',
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'set',
        key: 'providers.instances',
        value: [],
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'toggle',
        key: 'files.showHidden',
      }).success,
    ).toBe(false)
  })

  it('rejects empty, duplicate, and intersecting request operations', () => {
    expect(parseRequest([]).success).toBe(false)
    expect(
      parseRequest([
        { kind: 'set', key: 'editor.fontSize', value: 14 },
        { kind: 'set', key: 'editor.fontSize', value: 15 },
      ]).success,
    ).toBe(false)
    expect(
      parseRequest([
        { kind: 'keybinding.set', command: 'workspace.save', keys: 'Mod+S' },
        { kind: 'keybinding.remove', command: 'workspace.save' },
      ]).success,
    ).toBe(false)
    expect(
      parseRequest([
        { kind: 'reset', keys: ['models.hidden'] },
        { kind: 'model.setHidden', ref: MODEL_A, hidden: true },
      ]).success,
    ).toBe(false)
    expect(
      parseRequest([{ kind: 'reset', keys: ['editor.fontSize', 'editor.fontSize'] }]).success,
    ).toBe(false)
  })

  it('allows disjoint operations, including distinct members of one collection', () => {
    const parsed = parseRequest([
      { kind: 'set', key: 'editor.fontSize', value: 14 },
      { kind: 'keybinding.set', command: 'workspace.save', keys: 'Mod+S' },
      { kind: 'keybinding.remove', command: 'workspace.open' },
      { kind: 'model.setHidden', ref: MODEL_A, hidden: true },
      { kind: 'model.setHidden', ref: MODEL_B, hidden: false },
    ])

    expect(parsed.success).toBe(true)
  })

  it('validates model order as one unique absolute list', () => {
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'model.setOrder',
        order: [MODEL_A, MODEL_B],
      }).success,
    ).toBe(true)
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'model.setOrder',
        order: [MODEL_A, MODEL_A],
      }).success,
    ).toBe(false)
  })

  it('allows only valid provider environment names with forced-empty values in seeds', () => {
    const seed = {
      kind: 'provider.setEnabled',
      providerInstanceId: 'codex-work',
      enabled: false,
      createIfMissing: {
        driverKind: 'codex',
        environment: [{ name: 'OPENAI_API_KEY', value: '' }],
      },
    }

    expect(v.safeParse(settingsOperationSchema, seed).success).toBe(true)
    expect(
      v.safeParse(settingsOperationSchema, {
        ...seed,
        createIfMissing: {
          driverKind: 'codex',
          environment: [{ name: 'OPENAI_API_KEY', value: 'secret' }],
        },
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(settingsOperationSchema, {
        ...seed,
        createIfMissing: {
          driverKind: 'codex',
          environment: [{ name: 'OPENAI_API_KEY', value: REDACTED_SETTINGS_VALUE }],
        },
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(settingsOperationSchema, {
        ...seed,
        createIfMissing: {
          driverKind: 'codex',
          environment: [{ name: '1_INVALID', value: '' }],
        },
      }).success,
    ).toBe(false)
  })

  it('requires raw compare-and-swap identity and rejects obsolete normal-write fields', () => {
    expect(
      v.safeParse(settingsRawWriteRequestSchema, {
        writeId: 'raw-1',
        target: 'user',
        text: '{}\n',
        baseRevision: '',
      }).success,
    ).toBe(true)
    expect(
      v.safeParse(settingsRawWriteRequestSchema, {
        writeId: 'raw-1',
        target: 'user',
        text: '{}\n',
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(settingsMutationRequestSchema, {
        mutationId: 'mutation-1',
        target: 'user',
        operations: [{ kind: 'set', key: 'editor.fontSize', value: 14 }],
        baseRevision: 'obsolete',
      }).success,
    ).toBe(false)
  })

  it('carries ordered versions through snapshots, results, and events', () => {
    const snapshot = snapshotAt(7)
    const result = {
      mutationId: 'mutation-1',
      appliedVersion: snapshot.serverVersion,
      changedSettingIds: ['editor.fontSize'],
      duplicate: false,
      snapshot,
    }
    const rawResult = {
      writeId: 'raw-1',
      appliedVersion: snapshot.serverVersion,
      changedSettingIds: ['editor.fontSize'],
      duplicate: false,
      snapshot,
    }

    expect(v.parse(settingsMutationResultSchema, result)).toEqual(result)
    expect(v.parse(settingsRawWriteResultSchema, rawResult)).toEqual(rawResult)
    expect(
      v.parse(settingsEventSchema, {
        changedSettingIds: ['editor.fontSize'],
        originMutationId: 'mutation-1',
        snapshot,
      }),
    ).toMatchObject({ snapshot: { serverVersion: { epoch: 'epoch-a', sequence: 7 } } })
    expect(
      v.safeParse(settingsMutationResultSchema, {
        ...result,
        changedSettingIds: ['editor.fontSize', 'editor.fontSize'],
      }).success,
    ).toBe(false)
  })
})

describe('settings operation reducer', () => {
  it('sets one scalar without touching unknown or unrelated keys', () => {
    const raw = { 'editor.fontSize': 13, 'future.setting': { keep: true } }
    const result = applyIdempotently(raw, {
      kind: 'set',
      key: 'editor.fontSize',
      value: 18,
    })

    expect(result.raw).toEqual({ 'editor.fontSize': 18, 'future.setting': { keep: true } })
    expect(result.touchedSettingIds).toEqual(['editor.fontSize'])
  })

  it('prunes a scalar written back to its registry default', () => {
    const raw = { 'editor.fontSize': 18, 'future.setting': true }
    const result = applyIdempotently(raw, {
      kind: 'set',
      key: 'editor.fontSize',
      value: DEFAULT_SETTING_VALUES['editor.fontSize'],
    })

    expect(result.raw).toEqual({ 'future.setting': true })
    expect(result.touchedSettingIds).toEqual(['editor.fontSize'])
  })

  it('does not write a scalar that is already at its default', () => {
    const raw = { 'future.setting': true }
    const result = applyIdempotently(raw, {
      kind: 'set',
      key: 'editor.fontSize',
      value: DEFAULT_SETTING_VALUES['editor.fontSize'],
    })

    expect(result.raw).toBe(raw)
  })

  it('resets an atomic key batch and preserves everything else', () => {
    const raw = {
      'editor.fontSize': 18,
      'editor.lineHeight': 28,
      'future.setting': true,
    }
    const result = applyIdempotently(raw, {
      kind: 'reset',
      keys: ['editor.fontSize', 'editor.lineHeight'],
    })

    expect(result.raw).toEqual({ 'future.setting': true })
    expect(result.touchedSettingIds).toEqual(['editor.fontSize', 'editor.lineHeight'])
  })

  it('sets one keybinding and preserves unrelated command entries', () => {
    const raw = {
      'keybindings.overrides': {
        'workspace.open': 'Mod+O',
        'future.command': 'Mod+9',
      },
    }
    const result = applyIdempotently(raw, {
      kind: 'keybinding.set',
      command: 'workspace.save',
      keys: 'Mod+S',
    })

    expect(result.raw['keybindings.overrides']).toEqual({
      'workspace.open': 'Mod+O',
      'future.command': 'Mod+9',
      'workspace.save': 'Mod+S',
    })
  })

  it('removes one keybinding and deletes the default-empty collection', () => {
    const result = applyIdempotently(
      { 'keybindings.overrides': { 'workspace.save': 'Mod+S' }, untouched: true },
      { kind: 'keybinding.remove', command: 'workspace.save' },
    )

    expect(result.raw).toEqual({ untouched: true })
    expect(result.touchedSettingIds).toEqual(['keybindings.overrides'])
  })

  it('sets model membership without disturbing other refs or their order', () => {
    const hidden = applyIdempotently(
      { 'models.hidden': [MODEL_A], untouched: true },
      { kind: 'model.setHidden', ref: MODEL_B, hidden: true },
    )

    expect(hidden.raw['models.hidden']).toEqual([MODEL_A, MODEL_B])

    const visible = applyIdempotently(hidden.raw, {
      kind: 'model.setHidden',
      ref: MODEL_A,
      hidden: false,
    })
    expect(visible.raw['models.hidden']).toEqual([MODEL_B])
  })

  it('replaces model order atomically and resets an empty order', () => {
    const ordered = applyIdempotently(
      { 'models.order': [MODEL_B], untouched: true },
      { kind: 'model.setOrder', order: [MODEL_A, MODEL_B] },
    )

    expect(ordered.raw).toEqual({ 'models.order': [MODEL_A, MODEL_B], untouched: true })

    const reset = applyIdempotently(ordered.raw, { kind: 'model.setOrder', order: [] })
    expect(reset.raw).toEqual({ untouched: true })
  })

  it('patches only enabled on an existing provider instance', () => {
    const instance = {
      providerInstanceId: 'codex',
      driverKind: 'codex',
      displayLabel: 'Work',
      environment: [{ name: 'TOKEN', value: '' }],
      config: { sandbox: 'workspace' },
      futureField: { keep: true },
    }
    const result = applyIdempotently(
      { 'providers.instances': [instance], untouched: true },
      operation({
        kind: 'provider.setEnabled',
        providerInstanceId: 'codex',
        enabled: false,
      }),
    )

    expect(result.raw['providers.instances']).toEqual([{ ...instance, enabled: false }])
    expect(result.touchedSettingIds).toEqual(['providers.instances'])
  })

  it('materializes an untouched built-in only from a non-secret seed', () => {
    const result = applyIdempotently(
      { 'providers.instances': [], untouched: true },
      operation({
        kind: 'provider.setEnabled',
        providerInstanceId: 'codex-work',
        enabled: false,
        createIfMissing: {
          driverKind: 'codex',
          displayLabel: 'Codex Work',
          environment: [{ name: 'OPENAI_API_KEY', value: '' }],
          config: { profile: 'work' },
        },
      }),
    )

    expect(result.raw['providers.instances']).toEqual([
      {
        providerInstanceId: 'codex-work',
        driverKind: 'codex',
        displayLabel: 'Codex Work',
        enabled: false,
        binaryPath: '',
        environment: [{ name: 'OPENAI_API_KEY', value: '' }],
        config: { profile: 'work' },
      },
    ])
  })
})

describe('settings mutation resources', () => {
  it('distinguishes collection members but intersects a reset with any member', () => {
    const save = settingsOperationResourceKeys(
      operation({ kind: 'keybinding.set', command: 'workspace.save', keys: 'Mod+S' }),
    )[0]!
    const open = settingsOperationResourceKeys(
      operation({ kind: 'keybinding.remove', command: 'workspace.open' }),
    )[0]!
    const reset = settingsOperationResourceKeys({
      kind: 'reset',
      keys: ['keybindings.overrides'],
    })[0]!

    expect(settingsMutationResourcesIntersect(save, open)).toBe(false)
    expect(settingsMutationResourcesIntersect(reset, save)).toBe(true)
    expect(settingsMutationResourcesIntersect(save, reset)).toBe(true)
  })
})

function operation(input: unknown): SettingsOperation {
  return v.parse(settingsOperationSchema, input)
}

function parseRequest(operations: readonly unknown[]) {
  return v.safeParse(settingsMutationRequestSchema, {
    mutationId: 'mutation-1',
    target: 'user',
    operations,
  })
}

function applyIdempotently(raw: Readonly<Record<string, unknown>>, input: SettingsOperation) {
  const before = structuredClone(raw)
  const first = applySettingsOperations(raw, [input])
  const second = applySettingsOperations(first.raw, [input])

  expect(raw).toEqual(before)
  expect(second.raw).toBe(first.raw)
  expect(second.touchedSettingIds).toEqual(first.touchedSettingIds)

  return first
}

function modelRef(providerInstanceId: string, model: string): ModelRef {
  return v.parse(modelRefSchema, { providerInstanceId, model })
}

function snapshotAt(sequence: number) {
  return v.parse(settingsSnapshotSchema, {
    values: DEFAULT_SETTING_VALUES,
    layers: [],
    diagnostics: [],
    serverVersion: { epoch: 'epoch-a', sequence },
  })
}
