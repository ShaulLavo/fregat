import {
  descriptorFor,
  resolveThemeSettings,
  THEME_PART_KEYS,
  themePartPatch,
  type ColorMode,
  layerAllowsScope,
  settingsOperationSchema,
  type SettingId,
  type SettingsOperation,
  type SettingsSnapshot,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import * as v from 'valibot'
import { createClientError } from '@workspace/client-core/errors'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'

export function settingEditDisabledReason(
  id: SettingId | undefined,
  target: SettingsWriteTarget,
  enabled: boolean,
) {
  if (!enabled) return 'Reconnect before editing settings.'
  if (!id) return 'Select a setting first.'
  const descriptor = descriptorFor(id)
  if (descriptor.readOnlyReason) return descriptor.readOnlyReason
  if (!layerAllowsScope(target, descriptor.scope))
    return 'This setting can only be changed in user settings.'
  return null
}

export function settingDraft(
  id: SettingId,
  snapshot: SettingsSnapshot,
  target: SettingsWriteTarget,
  mode: ColorMode = 'dark',
) {
  if (
    target === 'user' &&
    snapshot.values['workbench.theme'] &&
    THEME_PART_KEYS.some((key) => key === id)
  ) {
    const values = resolveThemeSettings(snapshot.values, mode, snapshot.layers)
    return JSON.stringify(values[id], null, 2)
  }
  const layer = snapshot.layers.find((entry) => entry.id === target)
  const value =
    id === 'providers.instances' ? snapshot.values[id] : (layer?.raw[id] ?? snapshot.values[id])
  if (['string', 'font', 'multiline'].includes(descriptorFor(id).widget)) return String(value)
  return JSON.stringify(value, null, 2)
}

function parseSettingDraft(id: SettingId, draft: string) {
  const widget = descriptorFor(id).widget
  const value: unknown = ['string', 'font', 'multiline'].includes(widget)
    ? draft
    : JSON.parse(draft)
  return v.parse(descriptorFor(id).schema, value)
}

function settingOperations(
  id: SettingId,
  value: unknown,
  snapshot: SettingsSnapshot,
  target: SettingsWriteTarget,
  mode: ColorMode,
): readonly SettingsOperation[] | null {
  const current = snapshot.layers.find((entry) => entry.id === target)?.raw[id]
  if (id === 'lsp.servers' || id === 'lsp.languageServers' || id === 'lsp.semanticTokens.servers')
    return null
  if (id === 'environments.machines') return keyedOperations(current, value, 'machine')
  if (id === 'keybindings.overrides') return keyedOperations(current, value, 'keybinding')
  if (id === 'models.order') return [operation({ kind: 'model.setOrder', order: value })]
  if (id === 'models.hidden') return modelMembershipOperations(current, value, 'hidden')
  if (id === 'models.favorites') return modelMembershipOperations(current, value, 'favorite')
  if (id === 'providers.instances') return providerOperations(value, snapshot)
  const scalar = operation({ kind: 'set', key: id, value })
  const theme = snapshot.values['workbench.theme']
  const patch = scalar.kind === 'set' ? themePartPatch(scalar) : null
  if (!theme || !patch || target !== 'user') return [scalar]
  if (id === 'editor.codeTheme.light') mode = 'light'
  if (id === 'editor.codeTheme.dark') mode = 'dark'
  return [{ kind: 'theme.customize', id: theme.id, mode, patch }]
}

export async function saveSettingDraft({
  id,
  draft,
  snapshot,
  target,
  owner,
  signal,
  mode = 'dark',
}: {
  readonly id: SettingId
  readonly draft: string
  readonly snapshot: SettingsSnapshot
  readonly target: SettingsWriteTarget
  readonly owner: SettingsOwner
  readonly mode?: ColorMode
  readonly signal?: AbortSignal
}) {
  signal?.throwIfAborted()
  const value = parseSettingDraft(id, draft)
  const operations = settingOperations(id, value, snapshot, target, mode)
  if (operations) {
    if (operations.length === 0) return 'acknowledged'
    const result = owner.submit(target, operations, 'tui.settings')
    return result.kind === 'submitted' ? result.settled : 'discarded'
  }
  const layer = snapshot.layers.find((entry) => entry.id === target)
  await owner.writeRaw(
    target,
    JSON.stringify({ ...layer?.raw, [id]: value }, null, 2),
    layer?.file?.revision ?? '',
    signal,
  )
  return 'acknowledged'
}

export function choiceDraft(id: SettingId, value: string) {
  return descriptorFor(id).widget === 'boolean' ? value : JSON.stringify(value)
}

export function settingChoices(id: SettingId) {
  const schema = descriptorFor(id).schema
  if (descriptorFor(id).widget === 'boolean') return ['true', 'false']
  if ('options' in schema && Array.isArray(schema.options)) return schema.options.map(String)
  return null
}

function operation(input: unknown): SettingsOperation {
  return v.parse(settingsOperationSchema, input)
}

function keyedOperations(previous: unknown, next: unknown, kind: 'machine' | 'keybinding') {
  const current = v.parse(v.optional(v.record(v.string(), v.unknown()), {}), previous)
  const values = v.parse(v.record(v.string(), v.unknown()), next)
  const removed = Object.keys(current).filter((key) => !(key in values))
  const changed = Object.entries(values).filter(
    ([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value),
  )
  const removals = removed.map((key) =>
    operation(
      kind === 'machine'
        ? { kind: 'machine.remove', name: key }
        : { kind: 'keybinding.remove', command: key },
    ),
  )
  return [
    ...removals,
    ...changed.map(([key, value]) =>
      operation(
        kind === 'machine'
          ? { kind: 'machine.set', name: key, machine: value }
          : { kind: 'keybinding.set', command: key, keys: value },
      ),
    ),
  ]
}

function modelMembershipOperations(previous: unknown, next: unknown, list: 'favorite' | 'hidden') {
  const current = v.parse(v.optional(v.array(v.unknown()), []), previous)
  const values = v.parse(v.array(v.unknown()), next)
  const removed = current.filter(
    (ref) => !values.some((value) => JSON.stringify(value) === JSON.stringify(ref)),
  )
  const added = values.filter(
    (ref) => !current.some((value) => JSON.stringify(value) === JSON.stringify(ref)),
  )
  const set = (ref: unknown, member: boolean) =>
    operation(
      list === 'hidden'
        ? { kind: 'model.setHidden', ref, hidden: member }
        : { kind: 'model.setFavorite', ref, favorite: member },
    )
  return [...removed.map((ref) => set(ref, false)), ...added.map((ref) => set(ref, true))]
}

function providerOperations(next: unknown, snapshot: SettingsSnapshot) {
  const providers = v.parse(descriptorFor('providers.instances').schema, next)
  const current = snapshot.values['providers.instances']
  const withoutEnabled = (provider: (typeof providers)[number]) => ({
    ...provider,
    enabled: undefined,
  })
  if (
    JSON.stringify(providers.map(withoutEnabled)) !== JSON.stringify(current.map(withoutEnabled))
  ) {
    throw createClientError({
      code: 'tui.PROVIDER_CONFIGURATION_READ_ONLY',
      status: 400,
      message: 'Only provider enabled flags can be edited here.',
      why: 'Provider setup and secrets have a separate owner.',
      fix: 'Keep provider definitions unchanged and edit their enabled flags.',
    })
  }
  return providers
    .filter(
      (provider) =>
        current.find((entry) => entry.providerInstanceId === provider.providerInstanceId)
          ?.enabled !== provider.enabled,
    )
    .map((provider) =>
      operation({
        kind: 'provider.setEnabled',
        providerInstanceId: provider.providerInstanceId,
        enabled: provider.enabled,
        createIfMissing: {
          driverKind: provider.driverKind,
          displayLabel: provider.displayLabel,
          binaryPath: provider.binaryPath,
          config: provider.config,
          environment: provider.environment.map(({ name }) => ({ name, value: '' })),
        },
      }),
    )
}
