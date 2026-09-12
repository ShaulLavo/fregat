import { writeSettings, writeSettingsText } from '@workspace/client-core/settings/write'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { readSettings } from '@workspace/client-core/settings/read'
import {
  errorNumberField,
  errorStringField,
  type SettingsMutationRequest,
  type SettingsMutationResult,
  type SettingsRawWriteRequest,
  type SettingsRawWriteResult,
  type SettingsSnapshot,
} from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { createRpcError } from '@/lib/structured-errors'

export async function fetchSettings(
  signal: AbortSignal | undefined,
  client: Client,
): Promise<SettingsSnapshot> {
  return observeClientOperation(
    { ...clientLogContext(client), action: 'settings.read', area: 'settings', signal },
    () =>
      readSettings({ client, signal }).catch((error: unknown) => {
        throw createRpcError(error)
      }),
    summarizeSettings,
  )
}

export async function saveSettings(
  request: SettingsMutationRequest,
  client: Client,
): Promise<SettingsMutationResult> {
  return writeSettings({ client, request }).catch((error: unknown) => {
    throw createRpcError(error)
  })
}

/** Whole-document compare-and-swap for the raw JSON editor. */
export async function saveSettingsText(
  request: SettingsRawWriteRequest,
  client: Client,
): Promise<SettingsRawWriteResult> {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'settings.write-raw',
      area: 'settings',
      target: request.target,
      writeId: request.writeId,
    },
    () =>
      writeSettingsText({ client, request }).catch((error: unknown) => {
        throw createRpcError(error)
      }),
    summarizeRawWriteResult,
    rawWriteFailureOutcome,
  )
}

function summarizeRawWriteResult(result: SettingsRawWriteResult) {
  return {
    appliedEpoch: result.appliedVersion.epoch,
    appliedSequence: result.appliedVersion.sequence,
    changedSettingIds: result.changedSettingIds,
    duplicate: result.duplicate,
    outcome: result.duplicate ? 'duplicate-ack' : 'applied',
    snapshotEpoch: result.snapshot.serverVersion.epoch,
    snapshotSequence: result.snapshot.serverVersion.sequence,
  }
}

function rawWriteFailureOutcome(error: unknown) {
  const code = errorStringField(error, 'code')
  if (code === 'settings.RAW_REVISION_STALE') return 'raw-conflict'
  if (code === 'settings.WRITE_CONTENDED') return 'contended'

  const status = errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode')
  if (status !== undefined && status >= 400 && status < 500) return 'rejected'

  return 'transport-failed'
}

function summarizeSettings(snapshot: SettingsSnapshot) {
  return {
    diagnosticCount: snapshot.diagnostics.length,
    hiddenModelCount: snapshot.values['models.hidden'].length,
    keybindingOverrideCount: Object.keys(snapshot.values['keybindings.overrides']).length,
    providerInstanceCount: snapshot.values['providers.instances'].length,
    settingsEpoch: snapshot.serverVersion.epoch,
    settingsSequence: snapshot.serverVersion.sequence,
  }
}
