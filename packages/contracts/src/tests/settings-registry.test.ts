import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  DEFAULT_SETTING_VALUES,
  descriptorFor,
  isSettingId,
  SETTING_IDS,
  SETTINGS_REGISTRY,
  settingParentId,
  settingsValuesSchema,
  type SettingsValues,
} from '../settings/keys'
import { defineSetting, registryProblems } from '../settings/registry'
import {
  keybindingChordSchema,
  keybindingOverridesSchema,
  MAX_KEYBINDINGS_PER_COMMAND,
  lspServerOverridesSchema,
  MAX_KEYBINDING_CHORD_STROKES,
  modelRefListSchema,
  providerInstanceConfigsSchema,
} from '../settings'

describe('keybinding chord shape', () => {
  it.each([['Mod+S'], ['Mod+K Mod+S', 'F1'], [], null])('accepts %j', (keys) => {
    expect(v.safeParse(keybindingOverridesSchema, { 'workspace.saveFile': keys }).success).toBe(
      true,
    )
  })

  it.each(['Mod+K Mod+S Mod+X', '', '  ', 'Mod+K  Mod+S', 'Mod+K\tMod+S'])('rejects %s', (keys) => {
    expect(v.safeParse(keybindingOverridesSchema, { 'workspace.saveFile': [keys] }).success).toBe(
      false,
    )
  })

  it('keeps the schema stroke cap equal to the recorder cap', () => {
    const accepted = Array.from({ length: MAX_KEYBINDING_CHORD_STROKES }, () => 'Mod+K').join(' ')
    expect(v.safeParse(keybindingChordSchema, accepted).success).toBe(true)
    expect(v.safeParse(keybindingChordSchema, `${accepted} Mod+S`).success).toBe(false)
  })

  it('rejects a bare string where the list belongs, and a list past the cap', () => {
    expect(v.safeParse(keybindingOverridesSchema, { 'workspace.saveFile': 'Mod+S' }).success).toBe(
      false,
    )
    const tooMany = Array.from(
      { length: MAX_KEYBINDINGS_PER_COMMAND + 1 },
      (_, index) => `F${index + 1}`,
    )
    expect(v.safeParse(keybindingOverridesSchema, { 'workspace.saveFile': tooMany }).success).toBe(
      false,
    )
  })

  it('limits the stored shortcut length', () => {
    expect(v.safeParse(keybindingChordSchema, 'K'.repeat(64)).success).toBe(true)
    expect(v.safeParse(keybindingChordSchema, 'K'.repeat(65)).success).toBe(false)
  })
})

/**
 * Type-derivation gate.
 *
 * These are declarations, not assertions: `tsc --noEmit` is what enforces them.
 * `expectTypeOf` would be a runtime no-op here, because no vitest project in
 * this repo enables `test.typecheck` — a broken derivation would report green.
 */
// Assigning parse output to the derived type is the assertion: it only compiles
// if `SettingsValues[K]` really is `v.InferOutput<registry[K]['schema']>`,
// branded ids and all.
const _instancesAreProviderConfigs: SettingsValues['providers.instances'] = v.parse(
  providerInstanceConfigsSchema,
  [{ providerInstanceId: 'codex-personal', driverKind: 'codex' }],
)
const _hiddenIsModelRefList: SettingsValues['models.hidden'] = v.parse(modelRefListSchema, [
  { providerInstanceId: 'codex-personal', model: 'gpt-5' },
])
const _serversAreOverrides: SettingsValues['lsp.servers'] = v.parse(lspServerOverridesSchema, {
  typescript: { disabled: true, features: { completion: 5, semanticTokens: null } },
  'custom-lsp': { command: ['custom-lsp-server', '--stdio'], extensions: ['.custom'] },
})
const _overridesAreNullableStrings: SettingsValues['keybindings.overrides'] = {
  'workspace.saveFile': ['Mod+S', 'F2'],
  'workspace.saveAllFiles': null,
}

// @ts-expect-error a keybinding override is a list of strings or null, never a number
const _overrideRejectsNumber: SettingsValues['keybindings.overrides'] = { 'a.b': 3 }
// @ts-expect-error the instance list is an array, not a bare object
const _instancesRejectObject: SettingsValues['providers.instances'] = { providerInstanceId: 'x' }
// @ts-expect-error keys not in the registry have no type
const _unknownKeyHasNoType: SettingsValues['editor.notRegistered'] = 13

void _instancesAreProviderConfigs
void _overridesAreNullableStrings
void _hiddenIsModelRefList
void _serversAreOverrides
void _overrideRejectsNumber
void _instancesRejectObject
void _unknownKeyHasNoType

// The widget tag is bound to the schema the same way `default` is, so a control
// that cannot render its key's value is a compile error at the entry rather
// than a settings row that misbehaves at runtime.
const _fontTakesAString = defineSetting({
  schema: v.string(),
  default: '',
  scope: 'window',
  widget: 'font',
  category: 'X',
  description: 'x',
})
const _fontRejectsABoolean = defineSetting({
  schema: v.boolean(),
  default: true,
  scope: 'window',
  // @ts-expect-error a boolean cannot render a font picker
  widget: 'font',
  category: 'X',
  description: 'x',
})
const _modelsRejectProviders = defineSetting({
  schema: modelRefListSchema,
  default: [],
  scope: 'application',
  // @ts-expect-error a model list is not a provider list
  widget: 'providers',
  category: 'X',
  description: 'x',
})
const _providersRejectModels = defineSetting({
  schema: providerInstanceConfigsSchema,
  default: [],
  scope: 'application',
  // @ts-expect-error a provider list is not a model list
  widget: 'models',
  category: 'X',
  description: 'x',
})

void _fontTakesAString
void _fontRejectsABoolean
void _modelsRejectProviders
void _providersRejectModels

describe('settings registry', () => {
  it('accepts non-negative integer LSP feature ranks and null exclusions only', () => {
    expect(
      v.parse(lspServerOverridesSchema, {
        typescript: { features: { completion: 0, semanticTokens: null } },
      }),
    ).toEqual({
      typescript: {
        disabled: false,
        features: { completion: 0, semanticTokens: null },
      },
    })

    for (const features of [{ completion: -1 }, { completion: 1.5 }, { unknownFeature: 0 }]) {
      expect(v.safeParse(lspServerOverridesSchema, { typescript: { features } }).success).toBe(
        false,
      )
    }
  })

  it('registers no malformed id and no default that fails its own schema', () => {
    expect(registryProblems(SETTINGS_REGISTRY)).toEqual([])
  })

  it('catches a default that satisfies the type but violates the schema', () => {
    // `v.InferOutput` is `string` here, so the compiler is satisfied; only the
    // refinement can reject it. This is the class of mistake the runtime pass
    // exists for.
    const problems = registryProblems({
      'editor.fontFamily': defineSetting({
        schema: v.pipe(v.string(), v.maxLength(4)),
        default: 'far too long',
        scope: 'window',
        widget: 'string',
        category: 'Editor',
        description: 'x',
      }),
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ id: 'editor.fontFamily' })
    expect(problems[0].reason).toContain('default does not parse')
  })

  it('rejects an id that is not dotted lowerCamel segments', () => {
    const problems = registryProblems({
      nodots: defineSetting({
        schema: v.boolean(),
        default: true,
        scope: 'window',
        widget: 'boolean',
        category: 'X',
        description: 'x',
      }),
      '[typescript]': defineSetting({
        schema: v.boolean(),
        default: true,
        scope: 'window',
        widget: 'boolean',
        category: 'X',
        description: 'x',
      }),
    })

    expect(problems.map((problem) => problem.id)).toEqual(['nodots', '[typescript]'])
  })

  it("rejects merge: 'record' on a non-object default", () => {
    const problems = registryProblems({
      'a.b': defineSetting({
        schema: v.array(v.string()),
        default: [],
        scope: 'window',
        widget: 'list',
        category: 'X',
        description: 'x',
        merge: 'record',
      }),
    })

    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toContain('object default')
  })

  it('derives defaults from the descriptors rather than a second list', () => {
    for (const id of SETTING_IDS) {
      // A boolean child reads off under its off parent; every other key keeps its default.
      if (settingParentId(id) !== undefined && typeof descriptorFor(id).default === 'boolean')
        continue
      expect(DEFAULT_SETTING_VALUES[id]).toBe(descriptorFor(id).default)
    }
  })

  it('reads a boolean child as off while its parent defaults to off', () => {
    expect(descriptorFor('lsp.semanticTokens.enabled').default).toBe(false)
    expect(descriptorFor('lsp.semanticTokens.delta').default).toBe(true)
    expect(DEFAULT_SETTING_VALUES['lsp.semanticTokens.delta']).toBe(false)
  })

  it('rejects empty details', () => {
    const problems = registryProblems({
      'a.b': defineSetting({
        schema: v.boolean(),
        default: true,
        scope: 'window',
        widget: 'boolean',
        category: 'X',
        description: 'x',
        details: '  ',
      }),
    })

    expect(problems.map((problem) => problem.reason)).toEqual([
      'details must be omitted when there is nothing to say',
    ])
  })

  it('rejects a dependsOn parent the page cannot place the child under', () => {
    const toggle = (overrides: { category?: string; dependsOn?: string; rowOwner?: string } = {}) =>
      defineSetting({
        schema: v.boolean(),
        default: true,
        scope: 'window',
        widget: 'boolean',
        category: 'X',
        description: 'x',
        ...overrides,
      })
    const problems = registryProblems({
      'a.parent': toggle(),
      'a.child': toggle({ dependsOn: 'a.parent' }),
      'a.grandchild': toggle({ dependsOn: 'a.child' }),
      'a.missing': toggle({ dependsOn: 'a.nothing' }),
      'a.number': defineSetting({
        schema: v.number(),
        default: 1,
        scope: 'window',
        widget: 'number',
        category: 'X',
        description: 'x',
      }),
      'a.underNumber': toggle({ dependsOn: 'a.number' }),
      'a.elsewhere': toggle({ category: 'Y', dependsOn: 'a.parent' }),
      'a.self': toggle({ dependsOn: 'a.self' }),
      'a.owned': toggle({ rowOwner: 'a.parent' }),
      'a.underOwned': toggle({ dependsOn: 'a.owned' }),
    })

    expect(problems.map((problem) => problem.id)).toEqual([
      'a.grandchild',
      'a.missing',
      'a.underNumber',
      'a.elsewhere',
      'a.self',
      'a.underOwned',
    ])
  })

  it('parses an empty document into a complete set of defaults', () => {
    expect(v.parse(settingsValuesSchema, {})).toEqual(DEFAULT_SETTING_VALUES)
  })

  it('narrows an arbitrary string to a setting id', () => {
    expect(isSettingId('keybindings.overrides')).toBe(true)
    expect(isSettingId('keybindings')).toBe(false)
  })

  /**
   * The standing security rule, enforced rather than documented. Anything whose
   * value reaches process spawn, exec, env, or the keymap must not be readable
   * from a workspace file, because that file ships inside a cloned repository.
   */
  it('keeps every execution-reaching key out of the workspace layer', () => {
    const executionReaching = [
      'providers.instances',
      'keybindings.overrides',
      'lsp.servers',
      // Explicit selection can start a registered tool, so this is machine-scoped.
      'lsp.languageServers',
      'lsp.experimental.tyForPython',
      'lsp.idleTimeoutMs',
      'lsp.downloadRuntimes',
      // Not binary selection, but the same rule by the same reading as
      // `lsp.idleTimeoutMs`: all three decide how much work a language-server
      // child process on this machine performs, and a cloned repository must not
      // be able to turn that up.
      'lsp.semanticTokens.enabled',
      'lsp.semanticTokens.servers',
      'lsp.semanticTokens.delta',
    ] as const satisfies readonly (keyof typeof SETTINGS_REGISTRY)[]

    for (const id of executionReaching) {
      expect(['application', 'machine']).toContain(descriptorFor(id).scope)
    }
  })
})

it('keeps executable keymap presets application-scoped and restricted to implemented packs', () => {
  const descriptor = descriptorFor('keybindings.preset')
  expect(descriptor.scope).toBe('application')
  expect(descriptor.default).toBe('default')
  expect(v.safeParse(descriptor.schema, 'default').success).toBe(true)
  expect(v.safeParse(descriptor.schema, 'vscode').success).toBe(true)
  expect(v.safeParse(descriptor.schema, 'vim').success).toBe(false)
})
