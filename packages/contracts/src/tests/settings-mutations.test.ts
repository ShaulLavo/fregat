import { presentationFor } from '../settings/presentation'
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
    // Widgets choose an editor; only keys with domain mutations leave the scalar path.
    const bespokeSettings = new Set([
      'environments.machines',
      'lsp.servers',
      'lsp.languageServers',
      'lsp.semanticTokens.servers',
      'providers.instances',
      'models.hidden',
      'models.order',
      'models.favorites',
      'keybindings.overrides',
      'chat.projectResponseStreamingModes',
      'chat.textGenerationModel',
      'chat.projectTextGenerationModels',
      'chat.projectGroupingOverrides',
      'chat.projectAutoSettle',
      'git.projectAutoPull',
      'git.projectWorktreeSubmodules',
      'git.projectWorktreeCleanupOnDelete',
      'workbench.theme.customizations',
      'spellcheck.words',
    ])
    const expected = SETTING_IDS.filter((id) => !bespokeSettings.has(id))

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

  it('validates and applies a whole proxy source selection through scalar mutations', () => {
    const input = {
      kind: 'set',
      key: 'providers.proxyUsageProviderInstanceIds',
      value: ['codex-proxy-a', 'codex-proxy-b'],
    } as const
    expect(presentationFor(input.key).widget).toBe('complex')
    expect(parseRequest([input]).success).toBe(true)
    const result = applyIdempotently(
      { 'providers.proxyUsageProviderInstanceIds': ['codex-proxy-old'] },
      operation(input),
    )
    expect(result.raw).toEqual({ 'providers.proxyUsageProviderInstanceIds': input.value })
    expect(result.touchedSettingIds).toEqual(['providers.proxyUsageProviderInstanceIds'])
    expect(parseRequest([{ ...input, value: 'codex-proxy-a' }]).success).toBe(false)
  })

  it('validates and applies whole-record machine preferences through scalar mutations', () => {
    const value = {
      '00000000-0000-4000-8000-000000000001': 'prefer',
      '00000000-0000-4000-8000-000000000002': 'normal',
      '00000000-0000-4000-8000-000000000003': 'less-often',
      '00000000-0000-4000-8000-000000000004': 'manual-only',
    } as const
    const input: ScalarSettingOperation = {
      kind: 'set',
      key: 'environments.loadPreferences',
      value,
    }
    expect(presentationFor(input.key).widget).toBe('record')
    expect(parseRequest([input]).success).toBe(true)
    const result = applyIdempotently({ 'files.showHidden': true }, operation(input))
    expect(result.raw).toEqual({
      'files.showHidden': true,
      'environments.loadPreferences': value,
    })
    expect(result.touchedSettingIds).toEqual(['environments.loadPreferences'])
    expect(
      parseRequest([{ ...input, value: { [Object.keys(value)[0]!]: 'unsupported' } }]).success,
    ).toBe(false)
    expect(parseRequest([{ ...input, value: 'prefer' }]).success).toBe(false)
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
        { kind: 'keybinding.set', command: 'workspace.save', keys: ['Mod+S'] },
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
      { kind: 'keybinding.set', command: 'workspace.save', keys: ['Mod+S'] },
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

  it('replaces one exact context and targets only removed preset pairs', () => {
    const raw = {
      'keybindings.overrides': [
        { keys: 'F6', command: 'workspace.save', context: 'Workspace' },
        { keys: 'F7', command: 'workspace.save', context: 'Editor' },
        { keys: 'F8', command: 'future.command', context: 'Editor' },
        { keys: 'F9', command: null, context: 'Editor' },
      ],
    }
    const result = applyIdempotently(raw, {
      kind: 'keybinding.set',
      command: 'workspace.save',
      context: 'Editor',
      keys: ['Mod+S'],
      defaultKeys: ['Mod+S', 'F2'],
    })
    expect(result.raw['keybindings.overrides']).toEqual([
      raw['keybindings.overrides'][0],
      raw['keybindings.overrides'][2],
      raw['keybindings.overrides'][3],
      { keys: 'F2', unbind: 'workspace.save', context: 'Editor' },
      { keys: 'Mod+S', command: 'workspace.save', context: 'Editor' },
    ])
  })

  it('clears contextual keys with targeted unbinds and reset removes those rows', () => {
    const cleared = applyIdempotently(
      { untouched: true },
      {
        kind: 'keybinding.set',
        command: 'workspace.save',
        context: 'Editor',
        keys: null,
        defaultKeys: ['Mod+S'],
      },
    )
    expect(cleared.raw['keybindings.overrides']).toEqual([
      { keys: 'Mod+S', unbind: 'workspace.save', context: 'Editor' },
    ])
    const reset = applyIdempotently(cleared.raw, {
      kind: 'keybinding.remove',
      command: 'workspace.save',
      context: 'Editor',
    })
    expect(reset.raw).toEqual({ untouched: true })
    expect(reset.touchedSettingIds).toEqual(['keybindings.overrides'])
  })

  it('appends reservations in authored order and deletes exactly one index', () => {
    const entry = { keys: 'F9', command: null, context: 'Terminal' }
    const appended = applySettingsOperations(
      { 'keybindings.overrides': [{ keys: 'F8', command: 'future.command' }] },
      [operation({ kind: 'keybinding.append', entry })],
    )
    expect(appended.raw['keybindings.overrides']).toEqual([
      { keys: 'F8', command: 'future.command' },
      entry,
    ])
    const deleted = applySettingsOperations(appended.raw, [
      {
        kind: 'keybinding.delete',
        index: 0,
        expected: [{ keys: 'F8', command: 'future.command' }, entry],
      },
    ])
    expect(deleted.raw['keybindings.overrides']).toEqual([entry])
    const stale = applySettingsOperations(deleted.raw, [
      {
        kind: 'keybinding.delete',
        index: 0,
        expected: [{ keys: 'F8', command: 'future.command' }, entry],
      },
    ])
    expect(stale.raw['keybindings.overrides']).toEqual([entry])
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

  it('stars and unstars a favorite model at the end of the list', () => {
    const starred = applyIdempotently(
      { 'models.favorites': [MODEL_A] },
      { kind: 'model.setFavorite', ref: MODEL_B, favorite: true },
    )
    expect(starred.raw['models.favorites']).toEqual([MODEL_A, MODEL_B])
    expect(starred.touchedSettingIds).toEqual(['models.favorites'])

    const unstarred = applyIdempotently(starred.raw, {
      kind: 'model.setFavorite',
      ref: MODEL_A,
      favorite: false,
    })
    expect(unstarred.raw['models.favorites']).toEqual([MODEL_B])
  })

  it('writes one spellcheck word into the layer, keeping the words it already holds', () => {
    const added = applyIdempotently(
      { 'spellcheck.words': { fregat: true } },
      { kind: 'spellcheck.setWord', word: 'worktree', accepted: true },
    )
    expect(added.raw['spellcheck.words']).toEqual({ fregat: true, worktree: true })
    expect(added.touchedSettingIds).toEqual(['spellcheck.words'])

    const unaccepted = applyIdempotently(added.raw, {
      kind: 'spellcheck.setWord',
      word: 'fregat',
      accepted: false,
    })
    expect(unaccepted.raw['spellcheck.words']).toEqual({ fregat: false, worktree: true })
  })

  it('sets one project override and removes it, leaving the others', () => {
    const set = applyIdempotently(
      { 'git.projectAutoPull': { other: false } },
      { kind: 'project.set', key: 'git.projectAutoPull', projectId: 'project-a', value: true },
    )
    expect(set.raw['git.projectAutoPull']).toEqual({ other: false, 'project-a': true })
    expect(set.touchedSettingIds).toEqual(['git.projectAutoPull'])

    const removed = applyIdempotently(set.raw, {
      kind: 'project.set',
      key: 'git.projectAutoPull',
      projectId: 'other',
      value: null,
    })
    expect(removed.raw['git.projectAutoPull']).toEqual({ 'project-a': true })

    // The last entry leaves the record at its default, which the file does not keep.
    const empty = applyIdempotently(removed.raw, {
      kind: 'project.set',
      key: 'git.projectAutoPull',
      projectId: 'project-a',
      value: null,
    })
    expect(empty.raw).toEqual({})
  })

  it('edits title models and scoped grouping without replacing other projects', () => {
    const title = {
      ...modelRef('codex', 'fixture-model'),
      options: { reasoningEffort: 'low' },
    }
    const set = applyIdempotently(
      { 'chat.projectTextGenerationModels': { other: title } },
      {
        kind: 'project.set',
        key: 'chat.projectTextGenerationModels',
        projectId: 'project-a',
        value: title,
      },
    )
    expect(set.raw['chat.projectTextGenerationModels']).toEqual({
      other: title,
      'project-a': title,
    })
    const removed = applyIdempotently(set.raw, {
      kind: 'project.set',
      key: 'chat.projectTextGenerationModels',
      projectId: 'project-a',
      value: null,
    })
    expect(removed.raw['chat.projectTextGenerationModels']).toEqual({ other: title })
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'project.set',
        key: 'chat.projectTextGenerationModels',
        projectId: 'project-a',
        value: { model: '' },
      }).success,
    ).toBe(false)
    const grouped = applyIdempotently(
      { 'chat.projectGroupingOverrides': { 'owner-a:project-a': 'repository' } },
      {
        kind: 'project.set',
        key: 'chat.projectGroupingOverrides',
        projectId: 'owner-b:project-a',
        value: 'separate',
      },
    )
    expect(grouped.raw['chat.projectGroupingOverrides']).toEqual({
      'owner-a:project-a': 'repository',
      'owner-b:project-a': 'separate',
    })
  })

  it('refuses a project override that the record would not parse', () => {
    const parse = (value: unknown) =>
      v.safeParse(settingsOperationSchema, {
        kind: 'project.set',
        key: 'git.projectWorktreeSubmodules',
        projectId: 'project-a',
        value,
      }).success
    expect(parse('top-level')).toBe(true)
    expect(parse('everything')).toBe(false)
    expect(
      v.safeParse(settingsOperationSchema, {
        kind: 'project.set',
        key: 'git.autoPull',
        projectId: 'project-a',
        value: true,
      }).success,
    ).toBe(false)
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

describe('theme part removal', () => {
  const customizations = {
    graphite: {
      dark: { palette: 'sage', material: { blur: 3 } },
      light: { material: { blur: 5 } },
    },
  }

  it('removes one part from one half and drops the halves it empties', () => {
    const first = applyIdempotently(
      { 'workbench.theme.customizations': customizations },
      operation({ kind: 'theme.uncustomize', id: 'graphite', mode: 'dark', part: 'material.blur' }),
    )
    expect(first.raw['workbench.theme.customizations']).toEqual({
      graphite: { dark: { palette: 'sage' }, light: { material: { blur: 5 } } },
    })

    const second = applyIdempotently(
      { 'workbench.theme.customizations': customizations },
      operation({
        kind: 'theme.uncustomize',
        id: 'graphite',
        mode: 'light',
        part: 'material.blur',
      }),
    )
    expect(second.raw['workbench.theme.customizations']).toEqual({
      graphite: { dark: { palette: 'sage', material: { blur: 3 } } },
    })
  })

  it('leaves the document alone when there is nothing to remove', () => {
    const raw = { 'workbench.theme.customizations': customizations }
    const removals = [
      { kind: 'theme.uncustomize', id: 'nord', mode: 'dark', part: 'palette' },
      { kind: 'theme.uncustomize', id: 'graphite', mode: 'dark', part: 'wallpaper' },
      { kind: 'theme.uncustomize', id: 'graphite', mode: 'dark', part: 'material.opacity' },
      { kind: 'theme.uncustomize', id: 'graphite', mode: 'light', part: 'palette' },
    ]
    for (const removal of removals)
      expect(applySettingsOperations(raw, [operation(removal)]).raw).toBe(raw)
    const lightOnly = {
      'workbench.theme.customizations': { graphite: { light: { palette: 'sage' } } },
    }
    expect(
      applySettingsOperations(lightOnly, [
        operation({ kind: 'theme.uncustomize', id: 'graphite', mode: 'dark', part: 'palette' }),
      ]).raw,
    ).toBe(lightOnly)
  })

  it('shares a resource with a write of the same part and no other', () => {
    const remove = settingsOperationResourceKeys(
      operation({ kind: 'theme.uncustomize', id: 'graphite', mode: 'dark', part: 'material.blur' }),
    )[0]!
    const resource = (mode: string, material: Record<string, number>) =>
      settingsOperationResourceKeys(
        operation({ kind: 'theme.customize', id: 'graphite', mode, patch: { material } }),
      )[0]!

    expect(settingsMutationResourcesIntersect(remove, resource('dark', { blur: 4 }))).toBe(true)
    expect(settingsMutationResourcesIntersect(remove, resource('dark', { opacity: 4 }))).toBe(false)
    expect(settingsMutationResourcesIntersect(remove, resource('light', { blur: 4 }))).toBe(false)
  })
})

describe('settings mutation resources', () => {
  it('separates exact contexts while list append/delete lock the entire collection', () => {
    const root = settingsOperationResourceKeys({
      kind: 'keybinding.set',
      command: 'workspace.save',
      keys: ['F8'],
      context: 'Workspace',
    })[0]!
    const editor = settingsOperationResourceKeys({
      kind: 'keybinding.remove',
      command: 'workspace.save',
      context: 'Editor',
    })[0]!
    const appended = settingsOperationResourceKeys({
      kind: 'keybinding.append',
      entry: { keys: 'F9', command: null },
    })[0]!
    const deleted = settingsOperationResourceKeys({
      kind: 'keybinding.delete',
      index: 0,
      expected: [],
    })[0]!
    expect(settingsMutationResourcesIntersect(root, editor)).toBe(false)
    expect(settingsMutationResourcesIntersect(root, appended)).toBe(true)
    expect(settingsMutationResourcesIntersect(editor, deleted)).toBe(true)
  })

  it('distinguishes collection members but intersects a reset with any member', () => {
    const save = settingsOperationResourceKeys(
      operation({ kind: 'keybinding.set', command: 'workspace.save', keys: ['Mod+S'] }),
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
