import { UnreachableNotice } from '@/lib/environments/components/unreachable-notice'
import { useServerRestarting } from '@/lib/environments/hooks/use-server-restarting'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'
import { hasConnectionNotice } from '@/lib/environments/utils/availability'

export function StaleNotice() {
  const unavailable = useUnavailableEnvironment()
  // The titlebar's spinning Restart carries an expected restart.
  const restarting = useServerRestarting()
  if (restarting || !unavailable || !hasConnectionNotice(unavailable)) return null
  return <UnreachableNotice machine={unavailable.label ?? unavailable.name} />
}
