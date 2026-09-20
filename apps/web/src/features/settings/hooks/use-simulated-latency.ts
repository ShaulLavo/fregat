import { useEffect } from 'react'

import { useSettingValue } from '@/hooks/use-setting-value'
import { setSimulatedLatencyMs } from '@/lib/simulated-latency'

/** Pushes the developer latency setting into the transports, which cannot read settings themselves. */
export function useSimulatedLatency() {
  const latencyMs = useSettingValue('developer.simulatedLatencyMs')
  useEffect(() => {
    setSimulatedLatencyMs(latencyMs)
    return () => setSimulatedLatencyMs(0)
  }, [latencyMs])
}
