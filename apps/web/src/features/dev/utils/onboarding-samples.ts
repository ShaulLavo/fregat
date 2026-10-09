export const ONBOARDING_SAMPLES = [
  { id: 'choose', label: 'Choose a project' },
  { id: 'error', label: 'Open failed' },
  { id: 'connecting', label: 'Connecting' },
  { id: 'disconnected', label: 'Connection lost' },
  { id: 'opening', label: 'Opening' },
] as const

export type OnboardingSampleId = (typeof ONBOARDING_SAMPLES)[number]['id']

export function onboardingSample(id: string | null): OnboardingSampleId | null {
  return ONBOARDING_SAMPLES.find((sample) => sample.id === id)?.id ?? null
}
