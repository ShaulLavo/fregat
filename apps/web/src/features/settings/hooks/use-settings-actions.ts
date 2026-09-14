import {
  SETTING_IDS,
  deriveWriteTarget,
  descriptorFor,
  errorNumberField,
  errorStringField,
  layerAllowsScope,
  settingRowIds,
  type ModelRef,
  type MachineDefinition,
  type ProviderInstanceConfig,
  type ScalarSettingId,
  type SettingId,
  type SettingsOperation,
  type SettingsValues,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import { useMutation, useMutationState, type QueryClient } from '@tanstack/react-query'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'

import type { PlatformCommandId } from '@/keymap/types'
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
import { readLiveColorTheme } from '@/features/settings/state/live-projection'
import { saveSettings } from '@/features/settings/utils/api'
import { settingsMutationLogContext } from '@/features/settings/utils/mutation-observability'
import {
  settingsDurationBetween,
  settingsDurationSince,
  settingsMutationFailureOutcome,
  settingsMutationSuccessOutcome,
  settingsNow,
  settingsResultRequiresActiveEpochRetry,
  settingsRetryDelay,
  shouldRetrySettingsTransport,
} from '@workspace/client-core/settings/mutation-policy'
import { dismissSaveError, notifySaveError } from '@/features/settings/utils/notify-save-error'
import { providerEnabledOperation } from '@/features/settings/utils/operations'
import { admitSettingsMutationResult } from '@/features/settings/state/snapshot-admission'
import { annotateClientError, clientErrorMetadata } from '@/lib/client-error-context'
import { log } from '@/lib/client-logging'
import { clientInstanceId } from '@/lib/instance-id'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { withMovedModel } from '@/features/settings/utils/patch'

const SETTINGS_MUTATION_KEY = ['settings', 'mutation'] as const
const SETTINGS_MUTATION_SCOPE = 'settings-document'

/** Semantic settings actions shared by commands and settings controls. */
export function useSettingsActions() {
  const queryClient = useSettingsOwner()
  const client = clientForQueryClient(queryClient)
  const projection = useSettingsProjection()
  const transport = useMutation(
    {
      mutationFn: (entry: ActiveSettingsIntent) =>
        transportAndAdmitSettingsIntent(queryClient, entry, client),
      mutationKey: SETTINGS_MUTATION_KEY,
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
          retry: () => retryFailedIntent(failed.intentId, transport.mutate),
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
          durationMs: settingsDurationSince(startedAt),
          duplicate: result.duplicate,
          ...settingsMutationLogContext(entry),
          outcome: settingsMutationSuccessOutcome(result, admission.snapshot),
          queueWaitMs: settingsDurationBetween(entry.enqueuedAt, startedAt),
          snapshotEpoch: admission.snapshot?.serverVersion.epoch,
          snapshotSequence: admission.snapshot?.serverVersion.sequence,
        })
      },
      retry: shouldRetrySettingsTransport,
      retryDelay: settingsRetryDelay,
      scope: { id: SETTINGS_MUTATION_SCOPE },
    },
    queryClient,
  )
  const pendingTransports = useMutationState(
    {
      filters: { mutationKey: SETTINGS_MUTATION_KEY, status: 'pending' },
      select: () => true,
    },
    queryClient,
  )

  const submit = (
    target: SettingsWriteTarget,
    operations: readonly SettingsOperation[],
    initiator?: string,
  ): SettingsSubmission => {
    const { entry, supersededMutationIds } = submitSettingsIntent(
      queryClient,
      target,
      operations,
      initiator,
    )
    for (const mutationId of supersededMutationIds) dismissSaveError(mutationId)
    transport.mutate(entry)

    return {
      kind: 'submitted',
      mutationId: entry.intentId,
      settled: entry.settled,
    }
  }

  const targetFor = (key: SettingId) => deriveWriteTarget(key, projection?.layers ?? [])

  const setSetting = <K extends ScalarSettingId>(
    key: K,
    value: SettingsValues[K],
    target: SettingsWriteTarget = targetFor(key),
    initiator?: string,
  ): SettingsSubmission => {
    const operation = { kind: 'set', key, value } as SettingsOperation
    return submit(target, [operation], initiator)
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
    isSaving: pendingTransports.length > 0,
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
    resetKeybinding: (command: PlatformCommandId) =>
      submit(targetFor('keybindings.overrides'), [{ kind: 'keybinding.remove', command }]),
    resetSetting: (key: SettingId, target: SettingsWriteTarget = 'user') =>
      submit(target, [{ kind: 'reset', keys: settingRowIds(key) }]),
    setColorTheme,
    setKeybinding: (command: PlatformCommandId, keys: string | null) =>
      submit(targetFor('keybindings.overrides'), [{ command, keys, kind: 'keybinding.set' }]),
    setModelHidden: (ref: ModelRef, hidden: boolean) =>
      submit(targetFor('models.hidden'), [{ hidden, kind: 'model.setHidden', ref }]),
    setProviderEnabled: (instance: ProviderInstanceConfig, enabled: boolean) =>
      submit(targetFor('providers.instances'), [providerEnabledOperation(instance, enabled)]),
    setSetting,
  }
}

function retryFailedIntent(mutationId: string, mutate: (entry: ActiveSettingsIntent) => void) {
  const entry = retrySettingsIntent(mutationId)
  if (!entry) return

  dismissSaveError(mutationId)
  mutate(entry)
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
  const startedAt = markSettingsIntentTransportStarted(entry.intentId, settingsNow())
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
    annotateSettingsTransportError(entry, startedAt, error)
    throw error
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
      queueWaitMs: settingsDurationBetween(entry.enqueuedAt, startedAt),
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
    durationMs: settingsDurationSince(startedAt),
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
