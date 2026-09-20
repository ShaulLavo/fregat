import {
  errorNumberField,
  errorStringField,
  type SettingsMutationResult,
  type SettingsSnapshot,
} from '@workspace/contracts'

import { isConnectivityError } from '../transport/connectivity-error'

type SettingsAdmissionEvidence = {
  readonly acknowledgedIntent: unknown
  readonly snapshot: SettingsSnapshot | undefined
}

export function settingsResultRequiresActiveEpochRetry(
  result: SettingsMutationResult,
  admission: SettingsAdmissionEvidence,
) {
  if (admission.acknowledgedIntent) return false
  if (!admission.snapshot) return false

  return admission.snapshot.serverVersion.epoch !== result.snapshot.serverVersion.epoch
}

export function settingsMutationSuccessOutcome(
  result: SettingsMutationResult,
  confirmed: SettingsSnapshot | undefined,
) {
  if (result.duplicate) return 'duplicate-ack'
  if (confirmed && versionIsNewer(confirmed.serverVersion, result.snapshot.serverVersion)) {
    return 'acknowledged-after-newer-confirmed'
  }

  return 'applied'
}

export function settingsMutationFailureOutcome(error: unknown) {
  if (errorStringField(error, 'code') === 'settings.WRITE_CONTENDED') return 'contended'

  const status = errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode')
  if (status !== undefined && status >= 400 && status < 500) return 'rejected'

  return 'transport-failed'
}

export function shouldRetrySettingsTransport(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false
  if (errorStringField(error, 'code') === 'settings.WRITE_CONTENDED') return false
  if (isConnectivityError(error)) return true

  const status = errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode')
  return status !== undefined && status >= 500
}

export function settingsRetryDelay(attempt: number) {
  return Math.min(250 * 2 ** attempt, 1_000)
}

function versionIsNewer(
  current: { readonly epoch: string; readonly sequence: number },
  applied: { readonly epoch: string; readonly sequence: number },
) {
  if (current.epoch !== applied.epoch) return true

  return current.sequence > applied.sequence
}
