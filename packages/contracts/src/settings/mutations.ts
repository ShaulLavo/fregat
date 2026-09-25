import { slashPathsOverlap } from '@workspace/utils/slash-paths'
import {
  themeCustomizeOperationSchema,
  themeResetOperationSchema,
  themeCustomizationsSchema,
  type ThemeCustomizeOperation,
  type ThemeResetOperation,
} from '../themes/bundle'
import * as v from 'valibot'

import { providerInstanceIdSchema, type ProviderInstanceId } from '../chat-ids'
import { trimmedNonEmptyStringSchema } from '../chat-model'
import { isRecord } from '@workspace/utils/objects'
import { machineNameSchema, machineSchema, type MachineDefinition } from '../machines'
import { providerDriverKindSchema, type ProviderDriverKind } from '../orchestration-runtime'
import {
  keybindingCommandIdSchema,
  modelRefListSchema,
  modelRefSchema,
  providerEnvironmentVariableSchema,
  type ModelRef,
} from '../settings'
import { jsonEqual } from './json-equal'
import { descriptorFor, SETTING_IDS, type SettingId, type SettingsValues } from './keys'
import {
  settingIdSchema,
  settingsSnapshotSchema,
  settingsWriteTargetSchema,
  type SettingsSnapshot,
  type SettingsWriteTarget,
} from './wire'

const NON_SCALAR_SETTING_IDS = [
  'environments.machines',
  'lsp.servers',
  'lsp.languageServers',
  'lsp.semanticTokens.servers',
  'providers.instances',
  'models.hidden',
  'models.order',
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
] as const satisfies readonly SettingId[]

type NonScalarSettingId = (typeof NON_SCALAR_SETTING_IDS)[number]

export type ScalarSettingId = Exclude<SettingId, NonScalarSettingId>

export const SCALAR_SETTING_IDS: readonly ScalarSettingId[] = Object.freeze(
  SETTING_IDS.filter(
    (id): id is ScalarSettingId => !NON_SCALAR_SETTING_IDS.includes(id as NonScalarSettingId),
  ),
)

export type ScalarSettingOperation = {
  [K in ScalarSettingId]: {
    readonly kind: 'set'
    readonly key: K
    readonly value: SettingsValues[K]
  }
}[ScalarSettingId]

export type ResetSettingsOperation = {
  readonly kind: 'reset'
  readonly keys: readonly SettingId[]
}

export type SetKeybindingOperation = {
  readonly kind: 'keybinding.set'
  readonly command: string
  readonly keys: string | null
}

export type RemoveKeybindingOperation = {
  readonly kind: 'keybinding.remove'
  readonly command: string
}

type SetMachineOperation = {
  readonly kind: 'machine.set'
  readonly name: string
  readonly machine: MachineDefinition
}

type RemoveMachineOperation = {
  readonly kind: 'machine.remove'
  readonly name: string
}

export type SetModelHiddenOperation = {
  readonly kind: 'model.setHidden'
  readonly ref: ModelRef
  readonly hidden: boolean
}

export type SetModelOrderOperation = {
  readonly kind: 'model.setOrder'
  readonly order: readonly ModelRef[]
}

export type NonSecretProviderEnvironmentVariable = {
  readonly name: string
  readonly value: ''
}

export type NonSecretProviderSeed = {
  readonly driverKind: ProviderDriverKind
  readonly displayLabel?: string | null
  readonly binaryPath?: string
  readonly environment?: readonly NonSecretProviderEnvironmentVariable[]
  readonly config?: Readonly<Record<string, unknown>>
}

export type SetProviderEnabledOperation = {
  readonly kind: 'provider.setEnabled'
  readonly providerInstanceId: ProviderInstanceId
  readonly enabled: boolean
  readonly createIfMissing?: NonSecretProviderSeed
}

export type SettingsOperation =
  | ThemeCustomizeOperation
  | ThemeResetOperation
  | ScalarSettingOperation
  | ResetSettingsOperation
  | SetKeybindingOperation
  | RemoveKeybindingOperation
  | SetMachineOperation
  | RemoveMachineOperation
  | SetModelHiddenOperation
  | SetModelOrderOperation
  | SetProviderEnabledOperation

export type SettingsMutationRequest = {
  readonly mutationId: string
  readonly target: SettingsWriteTarget
  readonly operations: readonly SettingsOperation[]
}

export type SettingsMutationResult = {
  readonly mutationId: string
  readonly appliedVersion: SettingsSnapshot['serverVersion']
  readonly changedSettingIds: readonly SettingId[]
  readonly duplicate: boolean
  readonly snapshot: SettingsSnapshot
}

export type SettingsEvent = {
  readonly changedSettingIds: readonly SettingId[]
  readonly originMutationId?: string
  readonly snapshot: SettingsSnapshot
}

export type SettingsRawWriteRequest = {
  readonly writeId: string
  readonly target: SettingsWriteTarget
  readonly text: string
  readonly baseRevision: string
}

export type SettingsRawWriteResult = {
  readonly writeId: string
  readonly appliedVersion: SettingsSnapshot['serverVersion']
  readonly changedSettingIds: readonly SettingId[]
  readonly duplicate: boolean
  readonly snapshot: SettingsSnapshot
}

export type SettingsMutationReduction = {
  readonly raw: Readonly<Record<string, unknown>>
  readonly touchedSettingIds: readonly SettingId[]
}

export type SettingsMutationResourceKey = `setting:${string}`

const requestIdSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))

const scalarSettingOperationSchemas = SCALAR_SETTING_IDS.map((key) =>
  v.strictObject({
    kind: v.literal('set'),
    key: v.literal(key),
    value: descriptorFor(key).schema,
  }),
)

const uniqueSettingIdsSchema = v.pipe(
  v.array(settingIdSchema),
  v.minLength(1),
  v.check(hasUniqueSettingIds, 'reset keys must be unique'),
)

const nonSecretProviderEnvironmentVariableSchema = v.strictObject({
  name: providerEnvironmentVariableSchema.entries.name,
  value: v.literal(''),
})

export const nonSecretProviderSeedSchema: v.GenericSchema<unknown, NonSecretProviderSeed> =
  v.strictObject({
    driverKind: providerDriverKindSchema,
    displayLabel: v.optional(v.nullable(trimmedNonEmptyStringSchema)),
    binaryPath: v.optional(v.pipe(v.string(), v.trim())),
    environment: v.optional(v.array(nonSecretProviderEnvironmentVariableSchema)),
    config: v.optional(v.record(v.string(), v.unknown())),
  })

/**
 * The non-`set` branches, keyed by `kind`. The union below is built from these,
 * so a rejected request can re-check one branch on its own instead of reporting
 * the union's "Expected Object but received Object".
 */
export const settingsOperationSchemasByKind = {
  'theme.customize': themeCustomizeOperationSchema,
  'theme.reset': themeResetOperationSchema,
  reset: v.strictObject({ kind: v.literal('reset'), keys: uniqueSettingIdsSchema }),
  'machine.set': v.strictObject({
    kind: v.literal('machine.set'),
    name: machineNameSchema,
    machine: machineSchema,
  }),
  'machine.remove': v.strictObject({
    kind: v.literal('machine.remove'),
    name: machineNameSchema,
  }),
  'keybinding.set': v.strictObject({
    kind: v.literal('keybinding.set'),
    command: keybindingCommandIdSchema,
    keys: v.nullable(trimmedNonEmptyStringSchema),
  }),
  'keybinding.remove': v.strictObject({
    kind: v.literal('keybinding.remove'),
    command: keybindingCommandIdSchema,
  }),
  'model.setHidden': v.strictObject({
    kind: v.literal('model.setHidden'),
    ref: modelRefSchema,
    hidden: v.boolean(),
  }),
  'model.setOrder': v.strictObject({
    kind: v.literal('model.setOrder'),
    order: modelRefListSchema,
  }),
  'provider.setEnabled': v.strictObject({
    kind: v.literal('provider.setEnabled'),
    providerInstanceId: providerInstanceIdSchema,
    enabled: v.boolean(),
    createIfMissing: v.optional(nonSecretProviderSeedSchema),
  }),
} satisfies Record<Exclude<SettingsOperation['kind'], 'set'>, v.GenericSchema>

/** Every `kind` the operation union accepts, so a rejection can name a bad one. */
export const SETTINGS_OPERATION_KINDS: readonly SettingsOperation['kind'][] = Object.freeze([
  'set',
  ...(Object.keys(settingsOperationSchemasByKind) as Exclude<SettingsOperation['kind'], 'set'>[]),
])

export const settingsOperationSchema = v.union([
  ...scalarSettingOperationSchemas,
  ...Object.values(settingsOperationSchemasByKind),
] as unknown as [
  v.GenericSchema<unknown, SettingsOperation>,
  v.GenericSchema<unknown, SettingsOperation>,
  ...v.GenericSchema<unknown, SettingsOperation>[],
]) as v.GenericSchema<unknown, SettingsOperation>

const compatibleOperationsSchema = v.pipe(
  v.array(settingsOperationSchema),
  v.minLength(1),
  v.check(settingsOperationsAreCompatible, 'operations must target distinct semantic resources'),
)

export const settingsMutationRequestSchema: v.GenericSchema<unknown, SettingsMutationRequest> =
  v.strictObject({
    mutationId: requestIdSchema,
    target: settingsWriteTargetSchema,
    operations: compatibleOperationsSchema,
  })

const changedSettingIdsSchema = v.pipe(
  v.array(settingIdSchema),
  v.check(hasUniqueSettingIds, 'changed setting ids must be unique'),
)

export const settingsMutationResultSchema: v.GenericSchema<unknown, SettingsMutationResult> =
  v.strictObject({
    mutationId: requestIdSchema,
    appliedVersion: settingsSnapshotSchema.entries.serverVersion,
    changedSettingIds: changedSettingIdsSchema,
    duplicate: v.boolean(),
    snapshot: settingsSnapshotSchema,
  })

export const settingsEventSchema: v.GenericSchema<unknown, SettingsEvent> = v.strictObject({
  changedSettingIds: changedSettingIdsSchema,
  originMutationId: v.optional(requestIdSchema),
  snapshot: settingsSnapshotSchema,
})

export const settingsRawWriteRequestSchema: v.GenericSchema<unknown, SettingsRawWriteRequest> =
  v.strictObject({
    writeId: requestIdSchema,
    target: settingsWriteTargetSchema,
    text: v.string(),
    baseRevision: v.string(),
  })

export const settingsRawWriteResultSchema: v.GenericSchema<unknown, SettingsRawWriteResult> =
  v.strictObject({
    writeId: requestIdSchema,
    appliedVersion: settingsSnapshotSchema.entries.serverVersion,
    changedSettingIds: changedSettingIdsSchema,
    duplicate: v.boolean(),
    snapshot: settingsSnapshotSchema,
  })

export function applySettingsOperations(
  raw: Readonly<Record<string, unknown>>,
  operations: readonly SettingsOperation[],
): SettingsMutationReduction {
  let next = raw
  const touchedSettingIds: SettingId[] = []

  for (const operation of operations) {
    next = applySettingsOperation(next, operation)
    appendTouchedSettingIds(touchedSettingIds, operation)
  }

  return { raw: next, touchedSettingIds }
}

export function settingsOperationResourceKeys(
  operation: SettingsOperation,
): readonly SettingsMutationResourceKey[] {
  if (operation.kind === 'theme.reset')
    return [memberResourceKey('workbench.theme.customizations', operation.id)]
  if (operation.kind === 'theme.customize') {
    const base: SettingsMutationResourceKey = `${memberResourceKey('workbench.theme.customizations', operation.id)}/${operation.mode}`
    return Object.keys(operation.patch).flatMap((key) =>
      key === 'material'
        ? Object.keys(operation.patch.material ?? {}).map(
            (field): SettingsMutationResourceKey => `${base}/material/${field}`,
          )
        : [`${base}/${key}` as SettingsMutationResourceKey],
    )
  }
  if (operation.kind === 'set') return [settingResourceKey(operation.key)]
  if (operation.kind === 'reset') return operation.keys.map(settingResourceKey)
  if (operation.kind === 'machine.set' || operation.kind === 'machine.remove') {
    return [memberResourceKey('environments.machines', operation.name)]
  }
  if (operation.kind === 'keybinding.set' || operation.kind === 'keybinding.remove') {
    return [memberResourceKey('keybindings.overrides', operation.command)]
  }
  if (operation.kind === 'model.setHidden') {
    return [memberResourceKey('models.hidden', modelResourceId(operation.ref))]
  }
  if (operation.kind === 'model.setOrder') return [settingResourceKey('models.order')]

  return [memberResourceKey('providers.instances', operation.providerInstanceId)]
}

export function settingsMutationResourceKeys(
  operations: readonly SettingsOperation[],
): readonly SettingsMutationResourceKey[] {
  return operations.flatMap(settingsOperationResourceKeys)
}

export function settingsMutationResourcesIntersect(
  left: SettingsMutationResourceKey,
  right: SettingsMutationResourceKey,
): boolean {
  return slashPathsOverlap(left, right)
}

function applySettingsOperation(
  raw: Readonly<Record<string, unknown>>,
  operation: SettingsOperation,
): Readonly<Record<string, unknown>> {
  if (operation.kind === 'theme.customize' || operation.kind === 'theme.reset')
    return applyThemeOperation(raw, operation)
  if (operation.kind === 'set') return replaceSetting(raw, operation.key, operation.value)
  if (operation.kind === 'reset') return resetSettings(raw, operation.keys)
  if (operation.kind === 'machine.set') return setMachine(raw, operation)
  if (operation.kind === 'machine.remove') return removeMachine(raw, operation.name)
  if (operation.kind === 'keybinding.set') return setKeybinding(raw, operation)
  if (operation.kind === 'keybinding.remove') return removeKeybinding(raw, operation.command)
  if (operation.kind === 'model.setHidden') return setModelHidden(raw, operation)
  if (operation.kind === 'model.setOrder') {
    return replaceSetting(raw, 'models.order', operation.order)
  }

  return setProviderEnabled(raw, operation)
}

/**
 * A value equal to the registry default is removed rather than written. The
 * file holds only what the user chose, so toggling a setting on and off leaves
 * no trace, and a default the next build changes is not pinned by accident.
 */
function replaceSetting(
  raw: Readonly<Record<string, unknown>>,
  key: SettingId,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (jsonEqual(value, descriptorFor(key).default)) return resetSettings(raw, [key])
  if (Object.hasOwn(raw, key) && jsonEqual(raw[key], value)) return raw

  return { ...raw, [key]: value }
}

function resetSettings(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly SettingId[],
): Readonly<Record<string, unknown>> {
  if (!keys.some((key) => Object.hasOwn(raw, key))) return raw

  const next = { ...raw }
  for (const key of keys) delete next[key]

  return next
}

function setKeybinding(
  raw: Readonly<Record<string, unknown>>,
  operation: SetKeybindingOperation,
): Readonly<Record<string, unknown>> {
  const current = recordSetting(raw, 'keybindings.overrides')
  if (Object.hasOwn(current, operation.command) && current[operation.command] === operation.keys) {
    return raw
  }

  return replaceSetting(raw, 'keybindings.overrides', {
    ...current,
    [operation.command]: operation.keys,
  })
}

function setMachine(
  raw: Readonly<Record<string, unknown>>,
  operation: SetMachineOperation,
): Readonly<Record<string, unknown>> {
  const current = recordSetting(raw, 'environments.machines')
  return replaceSetting(raw, 'environments.machines', {
    ...current,
    [operation.name]: operation.machine,
  })
}

function removeMachine(
  raw: Readonly<Record<string, unknown>>,
  name: string,
): Readonly<Record<string, unknown>> {
  const current = recordSetting(raw, 'environments.machines')
  if (!Object.hasOwn(current, name)) return raw
  const next = { ...current }
  delete next[name]
  return replaceSetting(raw, 'environments.machines', next)
}

function removeKeybinding(
  raw: Readonly<Record<string, unknown>>,
  command: string,
): Readonly<Record<string, unknown>> {
  const current = recordSetting(raw, 'keybindings.overrides')
  if (!Object.hasOwn(current, command)) return raw

  const next = { ...current }
  delete next[command]

  return replaceSetting(raw, 'keybindings.overrides', next)
}

function setModelHidden(
  raw: Readonly<Record<string, unknown>>,
  operation: SetModelHiddenOperation,
): Readonly<Record<string, unknown>> {
  const current = arraySetting(raw, 'models.hidden')
  const includes = current.some((entry) => matchesModelRef(entry, operation.ref))
  if (includes === operation.hidden) return raw

  const next = operation.hidden
    ? [...current, operation.ref]
    : current.filter((entry) => !matchesModelRef(entry, operation.ref))

  return replaceSetting(raw, 'models.hidden', next)
}

function setProviderEnabled(
  raw: Readonly<Record<string, unknown>>,
  operation: SetProviderEnabledOperation,
): Readonly<Record<string, unknown>> {
  const current = arraySetting(raw, 'providers.instances')
  const index = current.findIndex((entry) => providerIdOf(entry) === operation.providerInstanceId)
  if (index < 0) return appendProviderSeed(raw, current, operation)

  const existing = current[index]
  if (!isRecord(existing) || providerEnabledOf(existing) === operation.enabled) return raw

  const next = current.with(index, { ...existing, enabled: operation.enabled })

  return replaceSetting(raw, 'providers.instances', next)
}

function appendProviderSeed(
  raw: Readonly<Record<string, unknown>>,
  current: readonly unknown[],
  operation: SetProviderEnabledOperation,
): Readonly<Record<string, unknown>> {
  const seed = operation.createIfMissing
  if (!seed) return raw

  const instance = {
    providerInstanceId: operation.providerInstanceId,
    driverKind: seed.driverKind,
    displayLabel: seed.displayLabel ?? null,
    enabled: operation.enabled,
    binaryPath: seed.binaryPath ?? '',
    environment: seed.environment ?? [],
    config: seed.config ?? {},
  }

  return replaceSetting(raw, 'providers.instances', [...current, instance])
}

function recordSetting(
  raw: Readonly<Record<string, unknown>>,
  key: 'environments.machines' | 'keybindings.overrides',
): Readonly<Record<string, unknown>> {
  const value = raw[key]

  return isRecord(value) ? value : {}
}

function arraySetting(
  raw: Readonly<Record<string, unknown>>,
  key: 'models.hidden' | 'providers.instances',
): readonly unknown[] {
  const value = raw[key]

  return Array.isArray(value) ? value : []
}

function matchesModelRef(value: unknown, ref: ModelRef): boolean {
  if (!isRecord(value)) return false

  return value.providerInstanceId === ref.providerInstanceId && value.model === ref.model
}

function providerIdOf(value: unknown): unknown {
  return isRecord(value) ? value.providerInstanceId : undefined
}

function providerEnabledOf(value: Readonly<Record<string, unknown>>): unknown {
  if (typeof value.enabled === 'boolean') return value.enabled

  return value.enabled === undefined ? true : value.enabled
}

function appendTouchedSettingIds(target: SettingId[], operation: SettingsOperation) {
  const ids = touchedSettingIds(operation)

  for (const id of ids) {
    if (target.includes(id)) continue
    target.push(id)
  }
}

function touchedSettingIds(operation: SettingsOperation): readonly SettingId[] {
  if (operation.kind === 'theme.customize' || operation.kind === 'theme.reset')
    return ['workbench.theme.customizations']
  if (operation.kind === 'set') return [operation.key]
  if (operation.kind === 'reset') return operation.keys
  if (operation.kind === 'machine.set' || operation.kind === 'machine.remove') {
    return ['environments.machines']
  }
  if (operation.kind === 'keybinding.set' || operation.kind === 'keybinding.remove') {
    return ['keybindings.overrides']
  }
  if (operation.kind === 'model.setHidden') return ['models.hidden']
  if (operation.kind === 'model.setOrder') return ['models.order']

  return ['providers.instances']
}

function hasUniqueSettingIds(ids: SettingId[]): boolean {
  return new Set(ids).size === ids.length
}

function settingsOperationsAreCompatible(operations: SettingsOperation[]): boolean {
  const accepted: SettingsMutationResourceKey[] = []

  for (const operation of operations) {
    const resources = settingsOperationResourceKeys(operation)
    if (hasResourceConflict(resources, accepted)) return false
    accepted.push(...resources)
  }

  return true
}

function hasResourceConflict(
  candidates: readonly SettingsMutationResourceKey[],
  accepted: readonly SettingsMutationResourceKey[],
): boolean {
  for (const candidate of candidates) {
    if (accepted.some((resource) => settingsMutationResourcesIntersect(candidate, resource))) {
      return true
    }
  }

  return false
}

function settingResourceKey(id: SettingId): SettingsMutationResourceKey {
  return `setting:${id}`
}

function memberResourceKey(id: SettingId, member: string): SettingsMutationResourceKey {
  return `${settingResourceKey(id)}/${encodeURIComponent(member)}`
}

function modelResourceId(ref: ModelRef): string {
  return `${ref.providerInstanceId.length}:${ref.providerInstanceId}${ref.model.length}:${ref.model}`
}

function applyThemeOperation(
  raw: Readonly<Record<string, unknown>>,
  operation: ThemeCustomizeOperation | ThemeResetOperation,
) {
  const parsed = v.safeParse(themeCustomizationsSchema, raw['workbench.theme.customizations'] ?? {})
  const customizations = parsed.success ? { ...parsed.output } : {}
  if (operation.kind === 'theme.reset') {
    delete customizations[operation.id]
    return replaceSetting(raw, 'workbench.theme.customizations', customizations)
  }
  const theme = customizations[operation.id] ?? {}
  const current = theme[operation.mode] ?? {}
  customizations[operation.id] = {
    ...theme,
    [operation.mode]: {
      ...current,
      ...operation.patch,
      ...(operation.patch.material
        ? { material: { ...current.material, ...operation.patch.material } }
        : {}),
    },
  }
  return replaceSetting(raw, 'workbench.theme.customizations', customizations)
}
