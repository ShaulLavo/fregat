import type { PushDevice, PushService } from '@workspace/contracts'

import type { ThisDevice } from '@/features/settings/utils/push-browser'
import { pushErrors } from '@/features/settings/utils/push-errors'

const SERVICE_NAMES: Record<PushService, string | null> = {
  apple: 'Apple',
  google: 'Google',
  mozilla: 'Mozilla',
  microsoft: 'Microsoft',
  other: null,
}

const REGISTERED = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** The row's second line: who delivers to it and since when. */
export function pushDeviceDetail(device: PushDevice) {
  const service = SERVICE_NAMES[device.service] ?? 'Push service'
  return { service, registered: REGISTERED.format(new Date(device.createdAt)) }
}

/** The whole row for a truncated label: its name, whose it is, and who delivers to it. */
export function pushDeviceTitle(device: PushDevice, isThisDevice: boolean) {
  const { registered } = pushDeviceDetail(device)
  const owner = isThisDevice ? ' (this device)' : ''
  const service = SERVICE_NAMES[device.service]
  const delivery = service ? `, delivered by ${service}` : ''

  return `${device.label}${owner}, registered ${registered}${delivery}`
}

/** Why this browser cannot turn push on, as the catalog words it; null when it can. */
export function thisDeviceBlocker(device: ThisDevice) {
  if (device.support === 'scope-taken') return pushErrors.SCOPE_TAKEN
  if (device.support === 'needs-install') return pushErrors.NOT_INSTALLED
  if (device.support === 'unsupported') return pushErrors.UNSUPPORTED
  if (device.permission === 'denied') return pushErrors.PERMISSION_DENIED

  return null
}

/** Search reaches the device list by these words as well as by its switch's title. */
export function matchesPushSearch(query: string) {
  const words = 'push notifications devices phone mobile browser test'
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => words.includes(word))
}
