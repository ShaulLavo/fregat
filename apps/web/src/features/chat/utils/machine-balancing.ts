import type { EnvironmentId, HostResources, SettingsValues } from '@workspace/contracts'

const MACHINE_PREFERENCES = [
  { value: 'prefer', label: 'Prefer', weight: 100 },
  { value: 'normal', label: 'Normal', weight: 50 },
  { value: 'less-often', label: 'Less often', weight: 25 },
  { value: 'manual-only', label: 'Manual only', weight: 0 },
] as const

type Preference = SettingsValues['environments.loadPreferences'][string]
export function machinePreferenceWeight(preference: Preference = 'normal') {
  return MACHINE_PREFERENCES.find((entry) => entry.value === preference)!.weight
}

export type MachineCapacity = {
  readonly environmentId: EnvironmentId
  readonly resources: HostResources | null
  readonly receivedAt: number
  readonly preference?: Preference
}

/** Receipt timestamps avoid comparing clocks belonging to different machines. */
export function chooseDraftMachine(candidates: readonly MachineCapacity[], now: number) {
  let selected: EnvironmentId | null = null
  let best = 0
  for (const { environmentId, resources, receivedAt, preference } of candidates) {
    const weight = machinePreferenceWeight(preference)
    if (!resources || weight === 0 || now - receivedAt > 15_000 || receivedAt > now + 5_000)
      continue
    if (resources.cpuUtilization === null || resources.cpuUtilization >= 0.95) continue
    const memory = resources.availableMemoryBytes / resources.totalMemoryBytes
    if (memory <= 0.05) continue
    const score = weight * resources.cpuCount * (1 - resources.cpuUtilization) * memory
    if (score <= best) continue
    best = score
    selected = environmentId
  }
  return selected
}
