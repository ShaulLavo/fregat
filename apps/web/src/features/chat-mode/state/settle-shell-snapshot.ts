import type { EnvironmentId } from '@workspace/contracts'

import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { environmentClientFor } from '@/lib/client'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'

export async function settleShellSnapshot(environmentId: EnvironmentId) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(environmentId))
  const snapshot = await fetchOrchestrationShellSnapshotHttp(client)
  useChatProjectionStore.getState().syncShellSnapshot(environmentId, snapshot)
}
