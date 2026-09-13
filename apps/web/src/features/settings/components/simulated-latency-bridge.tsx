import { useSimulatedLatency } from '@/features/settings/hooks/use-simulated-latency'

/** Renders nothing; exists so the latency dial is applied once, under the settings owner. */
export function SimulatedLatencyBridge() {
  useSimulatedLatency()
  return null
}
