import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import {
  SETTINGS_MUTATION_KEY,
  settingsMutationKeys,
} from '@/features/settings/utils/mutation-keys'
import { nowMs } from '@workspace/utils/timing'
import { shownColorMode, type ThemeBundle, type ThemeId } from '@workspace/contracts'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import {
  SETTING_IDS,
  deriveWriteTarget,
  descriptorFor,
  errorNumberField,
  errorStringField,
  layerAllowsScope,
  type KeybindingOverride,
  type ModelRef,
  type MachineDefinition,
  type ProviderInstanceConfig,
  type ScalarSettingId,
  type SettingId,
  type SettingsOperation,
  type SettingsValues,
  type SettingsWriteTarget,
  type SetProjectOverrideOperation,
  type ColorMode,
  type ThemeVariantPatch,
} from '@workspace/contracts'
import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import { runMutation } from '@/lib/mutations/run'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

import {
  discardFailedSettingsIntent,
  failSettingsIntent,
  markSettingsIntentTransportStarted,
  retrySettingsIntent,
  settingsIntentTransportStartedAt,
  settingsIntentStatus,
  settleSettingsIntentTransport,
  submitSettingsIntent,
  type ActiveSettingsIntent,
  type SettingsSubmission,
} from '@workspace/client-core/settings/intent-store'
import {
  readLiveColorTheme,
  readLiveSettingsProjection,
} from '@/features/settings/state/live-projection'
import { saveSettings } from '@/features/settings/utils/api'
import { settingsMutationLogContext } from '@/features/settings/utils/mutation-observability'
import {
  settingsMutationFailureOutcome,
  settingsMutationSuccessOutcome,
  settingsResultRequiresActiveEpochRetry,
  settingsRetryDelay,
  shouldRetrySettingsTransport,
} from '@workspace/client-core/settings/mutation-policy'
import { elapsedMs } from '@workspace/utils/timing'
import { durationBetweenMs } from '@workspace/utils/timing'
import { dismissSaveError, notifySaveError } from '@/features/settings/utils/notify-save-error'
import {
  providerEnabledOperation,
  resetSettingOperations,
  themeCustomization,
  themePartWriteOperation,
} from '@workspace/client-core/settings/operations'
import {
  admitSettingsMutationResult,
  refreshConfirmedSettings,
} from '@/features/settings/state/snapshot-admission'
import { annotateClientError, clientErrorMetadata } from '@/lib/client-error-context'
import { log } from '@/lib/client-logging'
import { clientInstanceId } from '@/lib/instance-id'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

import { withMovedModel } from '@/features/settings/utils/patch'

const SETTINGS_MUTATION_SCOPE = 'settings-document'

/** Semantic settings actions shared by commands and settings controls. */
/** `owner` writes another machine's settings, such as the one a file picker browses. */
export function useSettingsActions(owner?: QueryClient) {
  const settingsOwner = useSettingsOwner()
  const queryClient = owner ?? settingsOwner
  const client = clientForQueryClient(queryClient)
  // Read at call time: a subscription here would re-render every settings row on every write.
  const projection = () => readLiveSettingsProjection(queryClient)

  const submit = (
    target: SettingsWriteTarget,
    operations: readonly SettingsOperation[],
    initiator?: string,
  ): SettingsSubmission => {
    assertEnvironmentWritable(originForQueryClient(queryClient))
    const { entry, supersededMutationIds } = submitSettingsIntent(
      queryClient,
      target,
      operations,
      initiator,
    )
    for (const mutationId of supersededMutationIds) dismissSaveError(mutationId)
    sendSettingsIntent(queryClient, client, entry)

    return {
      kind: 'submitted',
      mutationId: entry.intentId,
      settled: entry.settled,
    }
  }

  const targetFor = (key: SettingId) => deriveWriteTarget(key, projection()?.layers ?? [])

  const shownMode = (values: SettingsValues) =>
    shownColorMode(values['workbench.colorTheme'], systemColorMode())

  const setSetting = <K extends ScalarSettingId>(
    key: K,
    value: SettingsValues[K],
    target: SettingsWriteTarget = targetFor(key),
    initiator?: string,
  ): SettingsSubmission => {
    const operation = { kind: 'set', key, value } as SettingsOperation
    const current = projection()
    const themed =
      target === 'user' && current
        ? themePartWriteOperation(operation, current.values, shownMode(current.values))
        : null
    return submit(target, [themed ?? operation], initiator)
  }

  const setColorTheme = (
    theme: SettingsValues['workbench.colorTheme'],
    fallback: SettingsValues['workbench.colorTheme'],
    initiator?: string,
  ): SettingsSubmission => {
    if (readLiveColorTheme(queryClient, fallback) === theme) return { kind: 'noop' }

    const operation: SettingsOperation = {
      key: 'workbench.colorTheme',
      kind: 'set',
      value: theme,
    }
    return submit(targetFor('workbench.colorTheme'), [operation], initiator)
  }

  return {
    selectBundle: (theme: ThemeBundle, initiator = 'settings.theme.select') =>
      submit('user', [{ kind: 'set', key: 'workbench.theme', value: theme }], initiator),
    resetBundle: (id: ThemeId) =>
      submit('user', [{ kind: 'theme.reset', id }], 'settings.theme.defaults'),
    /** The theme and both halves as edited, in one write: what the theme studio's Apply does. */
    applyBundle: (
      theme: ThemeBundle,
      patches: Readonly<Record<ColorMode, ThemeVariantPatch | null>>,
      initiator = 'theme-studio.apply',
    ) =>
      submit(
        'user',
        [
          { kind: 'set', key: 'workbench.theme', value: theme },
          { kind: 'theme.reset', id: theme.id, to: themeCustomization(patches) },
        ],
        initiator,
      ),
    setMachine: (name: string, machine: MachineDefinition) =>
      submit('user', [{ kind: 'machine.set', name, machine }]),
    removeMachine: (name: string) => submit('user', [{ kind: 'machine.remove', name }]),
    moveModel: (ref: ModelRef, direction: -1 | 1, displayed: readonly ModelRef[]) =>
      submit(targetFor('models.order'), [
        { kind: 'model.setOrder', order: withMovedModel(displayed, ref, direction) },
      ]),
    resetAll: (target: SettingsWriteTarget = 'user') => {
      const keys = SETTING_IDS.filter((key) => layerAllowsScope(target, descriptorFor(key).scope))
      return submit(target, [{ kind: 'reset', keys }])
    },
    resetKeybinding: (command: string, context?: string) =>
      submit(targetFor('keybindings.overrides'), [{ kind: 'keybinding.remove', command, context }]),
    appendKeybinding: (entry: KeybindingOverride) =>
      submit(targetFor('keybindings.overrides'), [{ kind: 'keybinding.append', entry }]),
    deleteKeybinding: (index: number, expected: readonly KeybindingOverride[]) =>
      submit(targetFor('keybindings.overrides'), [{ kind: 'keybinding.delete', index, expected }]),
    resetSetting: (
      key: SettingId,
      rowKeys: readonly SettingId[],
      target: SettingsWriteTarget = 'user',
    ) => {
      const current = projection()
      if (!current) return submit(target, [{ kind: 'reset', keys: rowKeys }])
      return submit(
        target,
        resetSettingOperations(key, current, target, shownMode(current.values), rowKeys),
      )
    },
    setColorTheme,
    setKeybinding: (
      command: string,
      keys: readonly string[] | null,
      options: { readonly context?: string; readonly defaultKeys?: readonly string[] } = {},
    ) =>
      submit(targetFor('keybindings.overrides'), [
        { command, keys, ...options, kind: 'keybinding.set' },
      ]),
    setModelHidden: (ref: ModelRef, hidden: boolean) =>
      submit(targetFor('models.hidden'), [{ hidden, kind: 'model.setHidden', ref }]),
    setModelFavorite: (ref: ModelRef, favorite: boolean) =>
      submit(targetFor('models.favorites'), [{ favorite, kind: 'model.setFavorite', ref }]),
    /** Accepts a word in one layer's spellcheck dictionary, or marks it again with `false`. */
    setSpellingWord: (word: string, accepted: boolean, target: SettingsWriteTarget) =>
      submit(target, [{ kind: 'spellcheck.setWord', word, accepted }], 'editor.spelling.addWord'),
    setProjectOverride: (operation: Omit<SetProjectOverrideOperation, 'kind'>) =>
      submit(targetFor(operation.key), [
        { ...operation, kind: 'project.set' } as SetProjectOverrideOperation,
      ]),
    setProviderEnabled: (instance: ProviderInstanceConfig, enabled: boolean) =>
      submit(targetFor('providers.instances'), [providerEnabledOperation(instance, enabled)]),
    setSetting,
  }
}

// Module scope, run through runMutation: one mutation per write, with no observer per caller.
function sendSettingsIntent(queryClient: QueryClient, client: Client, entry: ActiveSettingsIntent) {
  // Failures are handled in onError; the rejected promise has no other reader.
  runMutation(queryClient, settingsTransportOptions(queryClient, client, entry), entry).catch(
    () => undefined,
  )
}

function settingsTransportOptions(
  queryClient: QueryClient,
  client: Client,
  active: ActiveSettingsIntent,
) {
  return mutationOptions({
    mutationFn: (entry: ActiveSettingsIntent) =>
      transportAndAdmitSettingsIntent(queryClient, entry, client),
    mutationKey: active.patch.request.operations.some((operation) =>
      operation.kind.startsWith('keybinding.'),
    )
      ? settingsMutationKeys.keybindings
      : SETTINGS_MUTATION_KEY,
    onError: (error, entry) => {
      logSettingsMutationFailure(entry, error)
      if (settingsIntentStatus(entry.intentId) === 'acknowledged') return

      const failed = failSettingsIntent(entry.intentId, error)
      if (!failed) return
      if (failed.superseded) return

      notifySaveError({
        discard: () => discardFailedMutation(failed.intentId),
        error,
        mutationId: failed.intentId,
        retry: () => retryFailedIntent(queryClient, client, failed.intentId),
      })
    },
    onSettled: (_result, _error, entry) => {
      settleSettingsIntentTransport(entry.intentId)
    },
    onSuccess: ({ admission, result, startedAt }, entry) => {
      log.info({
        action: 'settings.write',
        appliedEpoch: result.appliedVersion.epoch,
        appliedSequence: result.appliedVersion.sequence,
        area: 'settings',
        clientInstanceId: clientInstanceId(),
        durationMs: elapsedMs(startedAt),
        duplicate: result.duplicate,
        ...settingsMutationLogContext(entry),
        outcome: settingsMutationSuccessOutcome(result, admission.snapshot),
        queueWaitMs: durationBetweenMs(entry.enqueuedAt, startedAt),
        snapshotEpoch: admission.snapshot?.serverVersion.epoch,
        snapshotSequence: admission.snapshot?.serverVersion.sequence,
      })
    },
    retry: shouldRetrySettingsTransport,
    retryDelay: settingsRetryDelay,
    scope: { id: SETTINGS_MUTATION_SCOPE },
  })
}

function retryFailedIntent(queryClient: QueryClient, client: Client, mutationId: string) {
  const entry = retrySettingsIntent(mutationId)
  if (!entry) return

  dismissSaveError(mutationId)
  sendSettingsIntent(queryClient, client, entry)
}

function discardFailedMutation(mutationId: string) {
  discardFailedSettingsIntent(mutationId)
  dismissSaveError(mutationId)
}

async function transportAndAdmitSettingsIntent(
  queryClient: QueryClient,
  entry: ActiveSettingsIntent,
  client: Client,
) {
  const startedAt = markSettingsIntentTransportStarted(entry.intentId, nowMs())
  try {
    let result = await saveSettings(entry.patch.request, client)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const admission = await awaitSettingsAdmission(queryClient, result)
      if (!settingsResultRequiresActiveEpochRetry(result, admission)) {
        return { admission, result, startedAt }
      }
      result = await saveSettings(entry.patch.request, client)
    }
    throw createClientInvariantError('Settings mutation could not establish an active epoch')
  } catch (error) {
    try {
      if (errorStringField(error, 'code') === 'settings.KEYBINDINGS_STALE')
        await refreshConfirmedSettings(queryClient)
    } finally {
      annotateSettingsTransportError(entry, startedAt, error)
      throw error
    }
  }
}

async function awaitSettingsAdmission(
  queryClient: QueryClient,
  result: Awaited<ReturnType<typeof saveSettings>>,
) {
  const admission = await admitSettingsMutationResult(queryClient, result)
  if (!admission.recoveryPending || !admission.confirmation) return admission

  return admission.confirmation
}

function annotateSettingsTransportError(
  entry: ActiveSettingsIntent,
  startedAt: number,
  error: unknown,
) {
  annotateClientError(error, {
    context: {
      ...settingsMutationLogContext(entry),
      clientInstanceId: clientInstanceId(),
      queueWaitMs: durationBetweenMs(entry.enqueuedAt, startedAt),
    },
    operation: 'settings.write',
  })
}

function logSettingsMutationFailure(entry: ActiveSettingsIntent, error: unknown) {
  const acknowledged = settingsIntentStatus(entry.intentId) === 'acknowledged'
  const startedAt = settingsIntentTransportStartedAt(entry.intentId) ?? entry.enqueuedAt
  const metadata = clientErrorMetadata(error)
  const event = {
    action: 'settings.write',
    area: 'settings',
    clientInstanceId: clientInstanceId(),
    durationMs: elapsedMs(startedAt),
    errorCode: errorStringField(error, 'code'),
    errorStatus: errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode'),
    ...settingsMutationLogContext(entry),
    ...metadata?.context,
    outcome: acknowledged
      ? 'acknowledged-after-newer-confirmed'
      : settingsMutationFailureOutcome(error),
  }
  if (acknowledged) {
    log.info(event)
    return
  }

  log.warn(event)
}
